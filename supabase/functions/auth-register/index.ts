// ===========================================================================
//  Edge Function : auth-register
//  POST /functions/v1/auth-register
//  Body: { phone, password, display_name? }
//
//  Stratégie sans Twilio : on utilise le provider Email (gratuit) en déguisant
//  le téléphone en email factice :  0341234567 → 0341234567@phone.local
//  L'utilisateur saisit son téléphone dans l'app ; la conversion est invisible.
//  Le vrai téléphone est stocké dans profiles.phone (pour Mobile Money).
// ===========================================================================
import { corsHeaders, withErrors, json, bad } from "../_shared/client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Normalise un téléphone malgache en forme locale 0XXXXXXXXX. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00261")) return "0" + digits.slice(5);
  if (digits.startsWith("261")) return "0" + digits.slice(3);
  return digits;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad("Méthode non autorisée.", 405);

  const body = await req.json().catch(() => null);
  if (!body) return bad("JSON invalide.");

  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  const displayName = String(body.display_name ?? "").trim().slice(0, 80);
  const referralCode = String(body.referral_code ?? "").trim().toUpperCase();

  if (!phone) return bad("Numéro de téléphone invalide.");
  if (password.length < 6) return bad("Mot de passe trop court (6 min).");

  const fakeEmail = `${phone}@phone.local`;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Vérifie l'unicité du téléphone côté profiles.
  const { data: existing } = await admin
    .from("profiles").select("id").eq("phone", phone).maybeSingle();
  if (existing) return bad("Ce numéro est déjà inscrit.");

  // Crée l'utilisateur via l'auth Email déguisée. Le trigger crée profil + wallet.
  const { data, error } = await admin.auth.admin.createUser({
    email: fakeEmail,
    password,
    email_confirm: true,  // pas de confirmation email requise
    user_metadata: { phone, display_name: displayName, username: `user_${phone}` },
  });
  if (error || !data.user) return bad("Inscription impossible : " + (error?.message ?? ""));

  // --- Parrainage : lie le filleul à son parrain si un code est fourni -------
  // Non bloquant : si le code est invalide, l'inscription réussit quand même.
  // (attach_referral est une RPC SECURITY DEFINER qui valide le code.)
  if (referralCode) {
    const { error: refErr } = await admin.rpc("attach_referral", {
      p_referred_id: data.user.id,
      p_code: referralCode,
    });
    if (refErr) {
      console.warn("[auth-register] attach_referral failed:", refErr.message);
      // On n'échoue pas l'inscription pour autant.
    }
  }

  // Session immédiate (compat : register renvoyait un JWT).
  const pub = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: sess, error: sessErr } = await pub.auth.signInWithPassword({
    email: fakeEmail,
    password,
  });
  if (sessErr || !sess.session) {
    return json({
      user: { id: data.user.id, phone, display_name: displayName, is_platform_admin: false },
      detail: "Compte créé. Connectez-vous pour obtenir votre session.",
    }, 201);
  }

  // CORRECTION : 2 requêtes séparées (la jointure profiles→wallets via auth.users
  // n'est pas détectée automatiquement par PostgREST).
  const { data: profile } = await admin
    .from("profiles").select("*").eq("id", data.user.id).single();
  const { data: wallet } = await admin
    .from("wallets").select("*").eq("user_id", data.user.id).single();

  return json({
    access: sess.session.access_token,
    refresh: sess.session.refresh_token,
    user: {
      id: profile.id, phone: profile.phone, display_name: profile.display_name ?? "",
      balance: wallet ? String(wallet.balance) : "0",
      available_balance: wallet ? String(Number(wallet.balance) - Number(wallet.locked_balance)) : "0",
      locked_balance: wallet ? String(wallet.locked_balance) : "0",
      bonus_locked: wallet ? String(wallet.bonus_locked) : "0",
      is_platform_admin: !!(profile.is_staff || profile.is_superuser),
      date_joined: profile.created_at,
    },
  }, 201);
}

Deno.serve(withErrors(handler));
