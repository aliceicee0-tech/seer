// ===========================================================================
//  Edge Function : markets
//  GET /functions/v1/markets              — liste catalogue (public)
//  GET /functions/v1/markets/:id          — détail marché
//  GET /functions/v1/markets/:id/orderbook — carnet d'ordres (public)
//  GET /functions/v1/markets/:id/trades    — historique transactions (public)
//  GET /functions/v1/markets/:id/price-history — historique des prix
//  GET /functions/v1/markets/:id/pool      — état de l'escrow (transparence)
//  GET /functions/v1/markets/:id/estimate  — estimation de gain
// ===========================================================================
import { corsHeaders, withErrors, json, bad, SHARE_VALUE } from "../_shared/client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return bad("Méthode non autorisée.", 405);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, ""); // trim slashes
  const parts = path.split("/"); // ["markets"] ou ["markets", "<id>", "<sub>"]
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);

  // GET /markets — catalogue (via v_markets : labels + prix + probas inclus)
  if (parts.length === 1) {
    const { data, error } = await anon
      .from("v_markets")
      .select("*")
      .order("is_featured", { ascending: false })
      .order("bet_close_at", { ascending: false });
    if (error) return bad("Erreur lecture.", 500);
    return json(data ?? []);
  }

  const marketId = Number(parts[1]);
  if (!marketId) return bad("ID marché invalide.");
  const sub = parts[2] ?? "";

  // GET /markets/:id — détail (via v_markets)
  if (sub === "") {
    const { data, error } = await anon.from("v_markets").select("*").eq("id", marketId).single();
    if (error || !data) return bad("Marché introuvable.", 404);
    return json(data);
  }

  // GET /markets/:id/orderbook — carnet agrégé, groupé par outcome (format frontend).
  // Frontend attend : [{ outcome, bids: [{price, quantity}], asks: [...], spread, last_price }]
  if (sub === "orderbook") {
    const { data: orders, error } = await anon
      .from("orders")
      .select("side, outcome, price, quantity, filled_quantity")
      .eq("market_id", marketId)
      .in("status", ["OPEN", "PARTIAL"]);
    if (error) return bad("Erreur lecture.", 500);

    const last = await lastTradePrice(anon, marketId);
    const result: any[] = [];
    for (const outcome of ["YES", "NO"] as const) {
      const bids: any[] = [], asks: any[] = [];
      for (const o of orders ?? []) {
        if (o.outcome !== outcome) continue;
        const remaining = o.quantity - o.filled_quantity;
        if (remaining <= 0) continue;
        const book = o.side === "BUY" ? bids : asks;
        const level = book.find((l: any) => Number(l.price) === Number(o.price));
        if (level) level.quantity += remaining;
        else book.push({ price: String(o.price), quantity: remaining });
      }
      // Tri : bids (achats) meilleur = +haut en premier ; asks (ventes) meilleur = +bas.
      bids.sort((a, b) => Number(b.price) - Number(a.price));
      asks.sort((a, b) => Number(a.price) - Number(b.price));
      const bestBid = bids[0]?.price ?? null;
      const bestAsk = asks[0]?.price ?? null;
      const spread = (bestBid && bestAsk)
        ? String(Number(bestAsk) - Number(bestBid)) : null;
      result.push({ outcome, bids, asks, spread, last_price: last !== null ? String(last) : null });
    }
    return json(result);
  }

  // GET /markets/:id/trades — historique (via v_trades : téléphones inclus).
  if (sub === "trades") {
    const { data, error } = await anon
      .from("v_trades")
      .select("*")
      .eq("market", marketId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100);
    if (error) return bad("Erreur lecture.", 500);
    return json(data ?? []);
  }

  // GET /markets/:id/price-history — série temporelle (via v_price_history).
  if (sub === "price-history") {
    const { data, error } = await anon
      .from("v_price_history")
      .select("at, price, quantity")
      .eq("market_id", marketId);
    if (error) return bad("Erreur lecture.", 500);
    return json(data ?? []);
  }

  // GET /markets/:id/pool — transparence de l'escrow (via v_market_pools).
  if (sub === "pool") {
    const { data, error } = await anon.from("v_market_pools").select("*").eq("market_id", marketId).single();
    if (error || !data) return bad("Pool introuvable.", 404);
    return json(data);
  }

  // GET /markets/:id/estimate — estimation de gain.
  if (sub === "estimate") {
    const outcome = (url.searchParams.get("outcome") ?? "").toUpperCase();
    const quantity = Number(url.searchParams.get("quantity") ?? 0);
    if (!["YES", "NO"].includes(outcome)) return bad("outcome invalide.");
    if (quantity <= 0) return bad("quantité invalide.");
    const last = await lastTradePrice(anon, marketId);
    const payout = SHARE_VALUE * quantity;
    return json({
      quantity: String(quantity),
      outcome,
      current_price: last ? String(last) : null,
      current_cost: last ? String(last * quantity) : null,
      payout_if_win: String(payout),
      profit_if_win: last ? String(payout - last * quantity) : null,
    });
  }

  return bad("Sous-route inconnue.", 404);
}

/** Dernier prix d'exécution sur un marché (quel que soit le côté). */
async function lastTradePrice(anon: any, marketId: number): Promise<number | null> {
  const { data } = await anon
    .from("trades")
    .select("price")
    .eq("market_id", marketId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  return data && data.length ? Number(data[0].price) : null;
}

/** Probabilités implicites dérivées du dernier prix. */
function proba(last: number | null): { YES: string; NO: string } {
  if (last === null) return { YES: "0.5000", NO: "0.5000" };
  const yes = (last / SHARE_VALUE).toFixed(4);
  return { YES: yes, NO: (1 - Number(yes)).toFixed(4) };
}

Deno.serve(withErrors(handler));
