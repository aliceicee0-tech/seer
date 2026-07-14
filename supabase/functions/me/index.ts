// ===========================================================================
//  Edge Function : me
//  GET  /functions/v1/me        — profil + solde (compat /api/me Django)
//  PATCH /functions/v1/me       — met à jour display_name
//  Reproduit accounts/views.py MeView.
// ===========================================================================
import { corsHeaders, withErrors, json, bad, currentUserId, adminClient } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const uid = await currentUserId(req);
  const admin = adminClient();

  if (req.method === "GET") {
    const { data: profile, error: e1 } = await admin
      .from("profiles").select("*").eq("id", uid).single();
    if (e1 || !profile) return bad("Profil introuvable.", 404);
    const { data: wallet } = await admin
      .from("wallets").select("*").eq("user_id", uid).single();
    return json({
      id: profile.id, phone: profile.phone, display_name: profile.display_name ?? "",
      balance: wallet ? String(wallet.balance) : "0",
      available_balance: wallet ? String(Number(wallet.balance) - Number(wallet.locked_balance)) : "0",
      locked_balance: wallet ? String(wallet.locked_balance) : "0",
      bonus_locked: wallet ? String(wallet.bonus_locked) : "0",
      is_platform_admin: !!(profile.is_staff || profile.is_superuser),
      date_joined: profile.created_at,
    });
  }

  if (req.method === "PATCH") {
    const body = await req.json().catch(() => null);
    if (!body) return bad("JSON invalide.");
    if (typeof body.display_name !== "string") return bad("display_name requis.");
    const { data: profile, error: e1 } = await admin
      .from("profiles")
      .update({ display_name: body.display_name.slice(0, 80) })
      .eq("id", uid)
      .select("*")
      .single();
    if (e1) return bad("Mise à jour impossible.");
    const { data: wallet } = await admin
      .from("wallets").select("*").eq("user_id", uid).single();
    return json({
      id: profile.id, phone: profile.phone, display_name: profile.display_name ?? "",
      balance: wallet ? String(wallet.balance) : "0",
      available_balance: wallet ? String(Number(wallet.balance) - Number(wallet.locked_balance)) : "0",
      locked_balance: wallet ? String(wallet.locked_balance) : "0",
      bonus_locked: wallet ? String(wallet.bonus_locked) : "0",
      is_platform_admin: !!(profile.is_staff || profile.is_superuser),
      date_joined: profile.created_at,
    });
  }

  return bad("Méthode non autorisée.", 405);
}

Deno.serve(withErrors(handler));
