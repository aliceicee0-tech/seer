// ===========================================================================
//  Edge Function : my-trading
//  GET /functions/v1/my-trading/bets — paris du joueur (pari mutuel)
//
//  Modèle pari mutuel : plus de positions ni d'ordres (modèle Polymarket abandonné).
// ===========================================================================
import { corsHeaders, withErrors, json, bad, currentUserId, adminClient } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return bad("Méthode non autorisée.", 405);

  const uid = await currentUserId(req);
  const admin = adminClient();
  const url = new URL(req.url);
  const what = url.pathname.replace(/\/+$/, "").split("/").pop() ?? "";

  // GET /my-trading/bets — paris du joueur
  if (what === "bets") {
    const status = url.searchParams.get("status");
    let q = admin
      .from("v_bets")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q.limit(100);
    if (error) return bad("Erreur lecture.", 500);
    return json(data ?? []);
  }

  return bad("Route inconnue.", 404);
}

Deno.serve(withErrors(handler));
