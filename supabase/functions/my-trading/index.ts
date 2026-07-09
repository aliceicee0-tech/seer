// ===========================================================================
//  Edge Function : my-trading
//  GET /functions/v1/my-trading/positions  — mes positions
//  GET /functions/v1/my-trading/orders     — mes ordres
//  Reproduit markets MyPositionsView + MyOrdersView.
// ===========================================================================
import { corsHeaders, withErrors, json, currentUserId, adminClient } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ detail: "Méthode non autorisée." }, 405);

  const uid = await currentUserId(req);
  const admin = adminClient();
  const url = new URL(req.url);
  const what = url.pathname.replace(/\/+$/, "").split("/").pop() ?? "";

  if (what === "positions") {
    const { data, error } = await admin
      .from("v_positions")
      .select("*")
      .eq("user_id", uid)
      .order("updated_at", { ascending: false });
    if (error) return json({ detail: "Erreur lecture." }, 500);
    return json(data ?? []);
  }

  if (what === "orders") {
    // v_orders n'a pas user_id (sécurité) : on filtre via la table orders.
    const { data: ids, error: e1 } = await admin
      .from("orders").select("id").eq("user_id", uid);
    if (e1) return json({ detail: "Erreur lecture." }, 500);
    const idList = (ids ?? []).map((r: any) => r.id);
    if (idList.length === 0) return json([]);
    const { data, error } = await admin
      .from("v_orders")
      .select("*")
      .in("id", idList)
      .order("created_at", { ascending: false });
    if (error) return json({ detail: "Erreur lecture." }, 500);
    return json(data ?? []);
  }

  return json({ detail: "Route inconnue." }, 404);
}

Deno.serve(withErrors(handler));
