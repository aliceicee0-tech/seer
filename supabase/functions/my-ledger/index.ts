// ===========================================================================
//  Edge Function : my-ledger
//  GET /functions/v1/my-ledger   — historique comptable du joueur connecté.
//  Reproduit accounts/views.py MyLedgerView.
// ===========================================================================
import { corsHeaders, withErrors, json, currentUserId, adminClient } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ detail: "Méthode non autorisée." }, 405);

  const uid = await currentUserId(req);
  const admin = adminClient();

  // Récupère le wallet_id de l'utilisateur.
  const { data: wallet } = await admin
    .from("wallets").select("id").eq("user_id", uid).single();
  if (!wallet) return json([]);

  // Liste des IDs d'écritures du wallet, puis lecture via la vue enrichie.
  const { data: entryIds, error: e1 } = await admin
    .from("ledger_entries").select("id").eq("wallet_id", wallet.id)
    .order("created_at", { ascending: false }).limit(200);
  if (e1) return json([]);
  const idList = (entryIds ?? []).map((r: any) => r.id);
  if (idList.length === 0) return json([]);

  const { data, error } = await admin
    .from("v_ledger_entries")
    .select("*")
    .in("id", idList)
    .order("created_at", { ascending: false });

  if (error) return json({ detail: "Erreur lecture." }, 500);
  return json(data ?? []);
}

Deno.serve(withErrors(handler));
