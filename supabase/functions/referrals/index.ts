// ===========================================================================
//  Edge Function : referrals
//  GET /functions/v1/referrals — code de parrainage + stats du joueur courant
//
//  Renvoie :
//    { code, link, stats: { invited, rewarded, total_earned }, referrals: [...] }
//
//  Le code est généré automatiquement à l'inscription par un trigger SQL.
//  Le bonus (500 Ar) est crédité au 1er dépôt du filleul, pas ici.
// ===========================================================================
import { corsHeaders, withErrors, json, bad, currentUserId, adminClient } from "../_shared/client.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return bad("Méthode non autorisée.", 405);

  const uid = await currentUserId(req);
  const admin = adminClient();

  // Code de parrainage du joueur.
  const { data: rc, error: e1 } = await admin
    .from("referral_codes").select("code").eq("user_id", uid).single();
  // Le code peut ne pas exister encore (trigger en retard ou migration fraîche).
  const code = rc?.code ?? null;

  // Stats : filleuls invités / récompensés / total gagné.
  const { data: refs, error: e2 } = await admin
    .from("referrals")
    // display_name du filleul pour affichage (sans exposer de donnée sensible).
    .select("id, referred_id, status, reward_amount, created_at, rewarded_at, referred:profiles!referrals_referred_id_fkey(display_name, phone)")
    .eq("referrer_id", uid)
    .order("created_at", { ascending: false });

  const list = (refs ?? []).map((r: any) => ({
    id: r.id,
    status: r.status,
    reward_amount: String(r.reward_amount),
    created_at: r.created_at,
    rewarded_at: r.rewarded_at,
    display_name: r.referred?.display_name ?? "Joueur",
    // Masque partiellement le téléphone pour la confidentialité.
    phone_masked: r.referred?.phone ? r.referred.phone.slice(0, 5) + "•••••" : "",
  }));

  const invited = list.length;
  const rewarded = list.filter((r) => r.status === "REWARDED").length;
  const totalEarned = list
    .filter((r) => r.status === "REWARDED")
    .reduce((s, r) => s + Number(r.reward_amount), 0);

  return json({
    code,
    // Lien d'invitation pré-construit (le domaine vient du frontend, on met
    // un chemin relatif que la page d'inscription saura interpréter).
    link: code ? `/register?ref=${code}` : null,
    stats: { invited, rewarded, total_earned: String(totalEarned) },
    referrals: list,
  });
}

Deno.serve(withErrors(handler));
