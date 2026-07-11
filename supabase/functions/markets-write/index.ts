// ===========================================================================
//  Edge Function : markets-write
//  POST   /functions/v1/markets-write/:id/bet   { outcome, amount }
//
//  Modèle pari mutuel : le joueur mise sur OUI ou NON, débit immédiat.
//  (Anciennes routes mint/merge/orders supprimées — modèle Polymarket abandonné)
// ===========================================================================
import { corsHeaders, withErrors, json, bad, currentUserId, userClient } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const uid = await currentUserId(req);
  const sb = userClient(req);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  const marketId = Number(parts[1]);
  const action = parts[2] ?? "";
  if (!marketId) return bad("ID marché invalide.");

  // --- PLACE BET (pari mutuel) ---
  if (action === "bet" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body) return bad("JSON invalide.");

    const outcome = String(body.outcome ?? "").toUpperCase();
    const amount = Number(body.amount ?? 0);

    if (!["YES", "NO"].includes(outcome)) return bad("outcome invalide (YES ou NO).");
    if (amount <= 0) return bad("Le montant doit être positif.");
    if (amount < 500) return bad("Mise minimale : 500 Ar.");

    const { data, error } = await sb.rpc("place_bet", {
      p_user_id: uid, p_market_id: marketId, p_outcome: outcome, p_amount: amount,
    });
    if (error) return bad(error.message);
    return json(data, 201);
  }

  return bad("Route inconnue.", 404);
}

Deno.serve(withErrors(handler));
