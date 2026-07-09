// ===========================================================================
//  Edge Function : payments
//  GET  /functions/v1/payments/mobile-money   — infos opérateurs (PUBLIC)
//  GET  /functions/v1/payments/deposits       — mes demandes de dépôt
//  POST /functions/v1/payments/deposits       — créer + déclarer un dépôt
//  GET  /functions/v1/payments/withdrawals    — mes retraits
//  POST /functions/v1/payments/withdrawals    — demander un retrait
//
//  Reproduit payments/views.py.
// ===========================================================================
import { corsHeaders, withErrors, json, bad, currentUserId, userClient, adminClient } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  const what = parts[1] ?? ""; // "mobile-money" | "deposits" | "withdrawals"

  // GET /payments/mobile-money — config opérateurs (PUBLIC, pas d'auth requise).
  // Doit rester accessible sans session : appelé par le frontend avant/durant le
  // parcours dépôt. On le traite AVANT currentUserId() sinon toute la page dépôt
  // reste bloquée sur le spinner (401 → info jamais setté).
  // Le frontend attend { holder, numbers: { MVOLA, ORANGE, AIRTEL } }.
  if (what === "mobile-money" && req.method === "GET") {
    return json({
      holder: Deno.env.get("MOBILE_MONEY_HOLDER") ?? "Nexus Madagascar",
      numbers: {
        MVOLA: Deno.env.get("MVOLA_NUMBER") ?? "",
        ORANGE: Deno.env.get("ORANGE_MONEY_NUMBER") ?? "",
        AIRTEL: Deno.env.get("AIRTEL_MONEY_NUMBER") ?? "",
      },
    });
  }

  // Toutes les autres routes exigent une session valide.
  const uid = await currentUserId(req);
  const sb = userClient(req);

  // ===== DÉPÔTS =====
  if (what === "deposits") {
    if (req.method === "GET") {
      // v_deposits n'a pas user_id ; on filtre via la table puis on récupère les ids.
      const { data: ids, error: e0 } = await adminClient()
        .from("deposit_requests").select("id").eq("user_id", uid);
      if (e0) return bad("Erreur lecture.", 500);
      const idList = (ids ?? []).map((r: any) => r.id);
      if (idList.length === 0) return json([]);
      const { data, error } = await adminClient()
        .from("v_deposits")
        .select("*")
        .in("id", idList)
        .order("created_at", { ascending: false });
      if (error) return bad("Erreur lecture.", 500);
      return json(data ?? []);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return bad("JSON invalide.");
      const amount = Number(body.amount ?? 0);
      const operator = String(body.operator ?? "").toUpperCase();
      // sender_phone est optionnel à la création (le joueur le saisit au declare).
      const sender_phone = String(body.sender_phone ?? "").trim();
      const operator_ref = String(body.operator_ref ?? "").trim();
      if (amount <= 0) return bad("Montant invalide.");
      if (!["MVOLA", "ORANGE", "AIRTEL"].includes(operator)) return bad("Opérateur invalide.");

      const { data, error } = await sb.rpc("create_deposit_request", {
        p_user_id: uid, p_amount: amount,
        p_operator: operator, p_sender_phone: sender_phone,
        p_operator_ref: operator_ref,
      });
      if (error) return bad(error.message);
      return json(data, 201);
    }

    // POST /payments/deposits/:id/declare — le joueur déclare son transfert.
    const declareId = Number(parts[2]);
    if (declareId && parts[3] === "declare" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return bad("JSON invalide.");
      const sender_phone = String(body.sender_phone ?? "").trim();
      const operator_ref = String(body.operator_ref ?? "").trim();
      if (!sender_phone) return bad("N° expéditeur requis.");

      // Vérifie que le dépôt appartient bien au joueur et est PENDING.
      const { data: dep, error: e1 } = await adminClient()
        .from("deposit_requests").select("id, user_id, status")
        .eq("id", declareId).single();
      if (e1 || !dep) return bad("Demande introuvable.", 404);
      if (dep.user_id !== uid) return bad("Accès refusé.", 403);
      if (dep.status !== "PENDING") return bad("Demande déjà traitée.", 400);

      const { data, error } = await adminClient()
        .from("deposit_requests")
        .update({ sender_phone, operator_ref })
        .eq("id", declareId)
        .select("*")
        .single();
      if (error) return bad(error.message);
      return json(data);
    }
  }

  // ===== RETRAITS =====
  if (what === "withdrawals") {
    if (req.method === "GET") {
      const { data: ids, error: e0 } = await adminClient()
        .from("withdraw_requests").select("id").eq("user_id", uid);
      if (e0) return bad("Erreur lecture.", 500);
      const idList = (ids ?? []).map((r: any) => r.id);
      if (idList.length === 0) return json([]);
      const { data, error } = await adminClient()
        .from("v_withdraws")
        .select("*")
        .in("id", idList)
        .order("created_at", { ascending: false });
      if (error) return bad("Erreur lecture.", 500);
      return json(data ?? []);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return bad("JSON invalide.");
      const amount = Number(body.amount ?? 0);
      const operator = String(body.operator ?? "").toUpperCase();
      const recipient_phone = String(body.recipient_phone ?? "").trim();
      if (amount <= 0) return bad("Montant invalide.");
      if (!["MVOLA", "ORANGE", "AIRTEL"].includes(operator)) return bad("Opérateur invalide.");
      if (!recipient_phone) return bad("N° réception requis.");

      const { data, error } = await sb.rpc("request_withdraw", {
        p_user_id: uid, p_amount: amount,
        p_operator: operator, p_recipient_phone: recipient_phone,
      });
      if (error) return bad(error.message);
      return json(data, 201);
    }
  }

  return bad("Route inconnue.", 404);
}

Deno.serve(withErrors(handler));
