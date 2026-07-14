// ===========================================================================
//  Edge Function : admin
//  Toutes les routes sont réservées aux administrateurs (is_staff/superuser).
//  Reproduit dashboard/views.py.
//
//  GET    /functions/v1/admin/stats                       — compteurs pilotage
//  GET    /functions/v1/admin/deposits                    — dépôts (filtrable)
//  POST   /functions/v1/admin/deposits/:id/approve        { note }
//  POST   /functions/v1/admin/deposits/:id/reject         { note }
//  GET    /functions/v1/admin/withdrawals                 — retraits (filtrable)
//  POST   /functions/v1/admin/withdrawals/:id/pay         { operator_ref, note }
//  POST   /functions/v1/admin/withdrawals/:id/reject      { note }
//  GET    /functions/v1/admin/markets                     — tous marchés (CRUD list)
//  POST   /functions/v1/admin/markets                     — créer un marché
//  PATCH  /functions/v1/admin/markets/:id                 — éditer un marché
//  POST   /functions/v1/admin/markets/:id/resolve         { outcome }
//  POST   /functions/v1/admin/markets/:id/cancel
//  DELETE /functions/v1/admin/markets/:id                 — supprime (si sans activité)
//  GET    /functions/v1/admin/users                       — joueurs (recherche)
//  GET    /functions/v1/admin/ledger                      — journal comptable global
//  GET    /functions/v1/admin/invariants                  — verify_invariants
//  GET    /functions/v1/admin/commission                  — config commission actuelle
//  PATCH  /functions/v1/admin/commission                  — { rate?, platform_user_id? }
// ===========================================================================
import { corsHeaders, withErrors, json, bad, requireAdmin, adminClient } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const uid = await requireAdmin(req); // lève 403 si non admin
  const admin = adminClient();
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const what = parts[1] ?? "";
  const id = Number(parts[2]);
  const action = parts[3] ?? "";

  // ===== STATS (vue d'ensemble) =====
  if (what === "stats" && req.method === "GET") {
    const [users, marketsOpen, marketsLocked, marketsResolved] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("markets").select("id", { count: "exact", head: true }).eq("status", "OPEN"),
      admin.from("markets").select("id", { count: "exact", head: true }).in("status", ["LOCKED", "RESOLVING"]),
      admin.from("markets").select("id", { count: "exact", head: true }).eq("status", "RESOLVED"),
    ]);

    // Montants : sommes par statut.
    const { data: depPend } = await admin.from("deposit_requests").select("amount").eq("status", "PENDING");
    const { data: depAppr } = await admin.from("deposit_requests").select("amount").eq("status", "APPROVED");
    const { data: wdPend } = await admin.from("withdraw_requests").select("amount").eq("status", "PENDING");
    const { data: wdPaid } = await admin.from("withdraw_requests").select("amount").eq("status", "PAID");

    const sum = (arr: any[]) => arr?.reduce((s, r) => s + Number(r.amount), 0) ?? 0;
    const depIn = sum(depAppr), wdOut = sum(wdPaid);

    return json({
      users_total: users.count ?? 0,
      markets_open: marketsOpen.count ?? 0,
      markets_locked: marketsLocked.count ?? 0,
      markets_resolved: marketsResolved.count ?? 0,
      deposits_pending: depPend?.length ?? 0,
      deposits_pending_amount: String(sum(depPend)),
      withdrawals_pending: wdPend?.length ?? 0,
      withdrawals_pending_amount: String(sum(wdPend)),
      cash_collected_net: String(depIn - wdOut),
    });
  }

  // ===== DÉPÔTS =====
  if (what === "deposits") {
    if (req.method === "GET") {
      const status = url.searchParams.get("status");
      let q = admin.from("v_admin_deposits")
        .select("*")
        .order("status", { ascending: true })
        .order("created_at", { ascending: false });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return bad("Erreur lecture.", 500);
      return json(data ?? []);
    }
    if (action === "approve" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { data, error } = await admin.rpc("approve_deposit", {
        p_deposit_id: id, p_admin_id: uid, p_note: String(body.note ?? ""),
      });
      if (error) return bad(error.message);
      return json(data);
    }
    if (action === "reject" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { data, error } = await admin.rpc("reject_deposit", {
        p_deposit_id: id, p_admin_id: uid, p_note: String(body.note ?? ""),
      });
      if (error) return bad(error.message);
      return json(data);
    }
  }

  // ===== RETRAITS =====
  if (what === "withdrawals") {
    if (req.method === "GET") {
      const status = url.searchParams.get("status");
      let q = admin.from("v_admin_withdraws")
        .select("*")
        .order("status", { ascending: true })
        .order("created_at", { ascending: true });
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return bad("Erreur lecture.", 500);
      return json(data ?? []);
    }
    if (action === "pay" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { data, error } = await admin.rpc("mark_withdraw_paid", {
        p_withdraw_id: id, p_admin_id: uid,
        p_operator_ref: String(body.operator_ref ?? ""),
        p_note: String(body.note ?? ""),
      });
      if (error) return bad(error.message);
      return json(data);
    }
    if (action === "reject" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { data, error } = await admin.rpc("reject_withdraw", {
        p_withdraw_id: id, p_admin_id: uid, p_note: String(body.note ?? ""),
      });
      if (error) return bad(error.message);
      return json(data);
    }
  }

  // ===== MARCHÉS (CRUD + résolution/annulation) =====
  if (what === "markets") {
    if (req.method === "GET") {
      const status = url.searchParams.get("status");
      const category = url.searchParams.get("category");
      // Liste admin = TOUS marchés (y compris DRAFT). v_markets les inclut.
      let q = admin.from("v_markets")
        .select("*")
        .order("is_featured", { ascending: false })
        .order("bet_close_at", { ascending: false });
      if (status) q = q.eq("status", status);
      if (category) q = q.eq("category", category);
      const { data, error } = await q;
      if (error) return bad("Erreur lecture.", 500);
      return json(data ?? []);
    }
    if (req.method === "POST" && action === "") {
      const body = await req.json().catch(() => null);
      if (!body) return bad("JSON invalide.");
      // Crée le marché + son pool associé.
      const { data: market, error } = await admin.from("markets").insert({
        question: body.question, description: body.description ?? "",
        category: body.category ?? "WEATHER",
        source_url: body.source_url ?? "", source_rules: body.source_rules ?? "",
        bet_close_at: body.bet_close_at, resolve_at: body.resolve_at,
        status: body.status ?? "DRAFT", is_featured: !!body.is_featured,
        image_url: body.image_url ?? "",
      }).select().single();
      if (error) return bad(error.message);
      await admin.from("market_pools").insert({ market_id: market.id });
      return json(market, 201);
    }
    if (req.method === "PATCH" && id && action === "") {
      const body = await req.json().catch(() => null);
      const { data, error } = await admin.from("markets").update(body).eq("id", id).select().single();
      if (error) return bad(error.message);
      return json(data);
    }
    if (action === "resolve" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const outcome = String(body.outcome ?? "").toUpperCase();
      if (!["YES", "NO"].includes(outcome)) return bad("outcome invalide.");
      const { error } = await admin.rpc("resolve_market", {
        p_market_id: id, p_outcome: outcome, p_admin_id: uid,
      });
      if (error) return bad(error.message);
      const { data: market } = await admin.from("markets").select("*").eq("id", id).single();
      return json(market);
    }
    if (action === "cancel" && req.method === "POST") {
      const { error } = await admin.rpc("cancel_market", { p_market_id: id, p_admin_id: uid });
      if (error) return bad(error.message);
      const { data: market } = await admin.from("markets").select("*").eq("id", id).single();
      return json(market);
    }
    if (action === "delete" && req.method === "POST") {
      const { error } = await admin.rpc("delete_market", { p_market_id: id, p_admin_id: uid });
      if (error) return bad(error.message);
      return json({ ok: true });
    }
  }

  // ===== JOUEURS (via v_admin_users : solde + positions_count inclus) =====
  if (what === "users" && req.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    let query = admin.from("v_admin_users")
      .select("*")
      .order("date_joined", { ascending: false });
    if (q) query = query.or(`phone.ilike.%${q}%,display_name.ilike.%${q}%`);
    const { data, error } = await query.limit(100);
    if (error) return bad("Erreur lecture.", 500);
    return json(data ?? []);
  }

  // ===== JOURNAL COMPTABLE GLOBAL (via v_admin_ledger) =====
  if (what === "ledger" && req.method === "GET") {
    const type = url.searchParams.get("type");
    const q = url.searchParams.get("q");
    let query = admin.from("v_admin_ledger")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (type) query = query.eq("type", type);
    if (q) query = query.or(`reference.ilike.%${q}%,note.ilike.%${q}%,user_phone.ilike.%${q}%`);
    const { data, error } = await query.limit(200);
    if (error) return bad("Erreur lecture.", 500);
    return json(data ?? []);
  }

  // ===== INVARIANTS =====
  if (what === "invariants" && req.method === "GET") {
    const { data, error } = await admin.rpc("verify_invariants");
    if (error) return bad(error.message);
    return json(data);
  }

  // ===== COMMISSION (config + diagnostic) =====
  // GET  → renvoie { commission_rate, platform_user_id, has_recipient }
  // PATCH → { rate?, platform_user_id? } met à jour la config.
  if (what === "commission") {
    if (req.method === "GET") {
      const { data, error } = await admin.from("platform_config").select("*").eq("id", 1).single();
      if (error) return bad("Config commission introuvable. Migration 0013 manquante ?");
      return json({
        commission_rate: Number(data.commission_rate),
        platform_user_id: data.platform_user_id,
        // Indique si un wallet dédié est configuré. Si false, la commission
        // tombe sur l'admin qui résout (fallback automatique depuis la 0020).
        has_recipient: data.platform_user_id !== null,
      });
    }
    if (req.method === "PATCH") {
      const body = await req.json().catch(() => null);
      if (!body) return bad("JSON invalide.");
      const patch: Record<string, unknown> = {};
      if (body.rate !== undefined) {
        const rate = Number(body.rate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
          return bad("rate doit être entre 0 et 100.");
        }
        patch.commission_rate = rate;
      }
      if (body.platform_user_id !== undefined) {
        // null pour effacer → fallback admin résolveur ; sinon un UUID valide.
        patch.platform_user_id = body.platform_user_id || null;
      }
      if (Object.keys(patch).length === 0) return bad("Rien à mettre à jour.");
      const { data, error } = await admin.from("platform_config")
        .update(patch).eq("id", 1).select("*").single();
      if (error) return bad(error.message);
      return json({
        commission_rate: Number(data.commission_rate),
        platform_user_id: data.platform_user_id,
        has_recipient: data.platform_user_id !== null,
      });
    }
  }

  return bad("Route admin inconnue.", 404);
}

Deno.serve(withErrors(handler));
