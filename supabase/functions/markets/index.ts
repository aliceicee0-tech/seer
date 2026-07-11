// ===========================================================================
//  Edge Function : markets
//  GET /functions/v1/markets           — liste catalogue (public, filtrable)
//  GET /functions/v1/markets/:id       — détail marché (public)
//  GET /functions/v1/markets/:id/pool  — pools + cotes pari mutuel (public)
//
//  Modèle pari mutuel : plus de carnet d'ordres ni de price-history.
//  Les cotes sont calculées depuis les pools (pool_yes / pool_no).
// ===========================================================================
import { corsHeaders, withErrors, json, bad } from "../_shared/client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return bad("Méthode non autorisée.", 405);

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  const parts = path.split("/");
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);

  // GET /markets — catalogue
  if (parts.length === 1) {
    const category = url.searchParams.get("category");
    const status = url.searchParams.get("status");
    let q = anon
      .from("v_markets")
      .select("*")
      .order("is_featured", { ascending: false })
      .order("bet_close_at", { ascending: false });
    if (category) q = q.eq("category", category);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return bad("Erreur lecture.", 500);
    return json(data ?? []);
  }

  const marketId = Number(parts[1]);
  if (!marketId) return bad("ID marché invalide.");
  const sub = parts[2] ?? "";

  // GET /markets/:id — détail
  if (sub === "") {
    const { data, error } = await anon.from("v_markets").select("*").eq("id", marketId).single();
    if (error || !data) return bad("Marché introuvable.", 404);
    return json(data);
  }

  // GET /markets/:id/pool — cotes pari mutuel
  if (sub === "pool") {
    const { data: m, error } = await anon
      .from("markets")
      .select("pool_yes, pool_no")
      .eq("id", marketId)
      .single();
    if (error || !m) return bad("Marché introuvable.", 404);

    const poolYes = Number(m.pool_yes);
    const poolNo = Number(m.pool_no);
    const total = poolYes + poolNo;

    // Cote = total / pool_côté. Si un côté est à 0, cote infinie (on retourne null).
    const oddsYes = poolYes > 0 ? Number((total / poolYes).toFixed(2)) : null;
    const oddsNo = poolNo > 0 ? Number((total / poolNo).toFixed(2)) : null;

    return json({
      pool_yes: String(poolYes),
      pool_no: String(poolNo),
      total: String(total),
      odds_yes: oddsYes,
      odds_no: oddsNo,
    });
  }

  return bad("Sous-route inconnue.", 404);
}

Deno.serve(withErrors(handler));
