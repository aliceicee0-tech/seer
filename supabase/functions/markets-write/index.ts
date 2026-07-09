// ===========================================================================
//  Edge Function : markets-write
//  POST   /functions/v1/markets-write/:id/mint    { count }
//  POST   /functions/v1/markets-write/:id/merge   { count }
//  POST   /functions/v1/markets-write/:id/orders  { side, outcome, order_type, quantity, price?, expires_at? }
//  DELETE /functions/v1/markets-write/:id/orders/:order_id
//
//  Toutes les écritures passent par les fonctions RPC PL/pgSQL (atomicité +
//  verrous). L'Edge Function ne fait que valider l'entrée et appeler le RPC.
// ===========================================================================
import { corsHeaders, withErrors, json, bad, currentUserId, userClient, MIN_ORDER_PRICE, MAX_ORDER_PRICE } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const uid = await currentUserId(req);
  const sb = userClient(req);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/"); // ["markets-write", "<id>", "<action>", ...]
  const marketId = Number(parts[1]);
  const action = parts[2] ?? "";
  if (!marketId) return bad("ID marché invalide.");

  // --- MINT ---
  if (action === "mint" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    const count = Number(body?.count ?? 0);
    if (count <= 0) return bad("count doit être positif.");
    const { error } = await sb.rpc("mint_pair", {
      p_user_id: uid, p_market_id: marketId, p_count: count,
    });
    if (error) return bad(rpcMsg(error));
    return json({ ok: true });
  }

  // --- MERGE ---
  if (action === "merge" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    const count = Number(body?.count ?? 0);
    if (count <= 0) return bad("count doit être positif.");
    const { error } = await sb.rpc("merge_pair", {
      p_user_id: uid, p_market_id: marketId, p_count: count,
    });
    if (error) return bad(rpcMsg(error));
    return json({ ok: true });
  }

  // --- CREATE ORDER ---
  if (action === "orders" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body) return bad("JSON invalide.");

    const side = String(body.side ?? "").toUpperCase();
    const outcome = String(body.outcome ?? "").toUpperCase();
    const order_type = String(body.order_type ?? "").toUpperCase();
    const quantity = Number(body.quantity ?? 0);

    if (!["BUY", "SELL"].includes(side)) return bad("side invalide (BUY ou SELL).");
    if (!["YES", "NO"].includes(outcome)) return bad("outcome invalide (YES ou NO).");
    if (!["LIMIT", "MARKET"].includes(order_type)) return bad("order_type invalide (LIMIT ou MARKET).");
    if (quantity <= 0) return bad("quantité doit être positive.");

    let price: number | null = null;
    if (order_type === "LIMIT") {
      price = Number(body.price);
      if (Number.isNaN(price)) return bad("Prix manquant (LIMIT).");
      if (price < MIN_ORDER_PRICE || price > MAX_ORDER_PRICE)
        return bad(`Prix hors bornes [${MIN_ORDER_PRICE}, ${MAX_ORDER_PRICE}].`);
    }

    const { data, error } = await sb.rpc("place_order", {
      p_user_id: uid, p_market_id: marketId,
      p_side: side, p_outcome: outcome, p_order_type: order_type,
      p_quantity: quantity, p_price: price,
      p_expires_at: body.expires_at ?? null,
    });
    if (error) return bad(rpcMsg(error));
    return json({ id: data }, 201);
  }

  // --- CANCEL ORDER ---
  if (action === "orders" && req.method === "DELETE") {
    const orderId = Number(parts[3]);
    if (!orderId) return bad("order_id invalide.");
    const { error } = await sb.rpc("cancel_order", {
      p_order_id: orderId, p_user_id: uid,
    });
    if (error) return bad(rpcMsg(error));
    return json({ ok: true });
  }

  return bad("Route inconnue.", 404);
}

/** Extrait un message lisible depuis une erreur RPC (Supabase encapsule le SQLSTATE). */
function rpcMsg(e: { message?: string }): string {
  return e?.message ?? "Erreur métier.";
}

Deno.serve(withErrors(handler));
