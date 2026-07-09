// ===========================================================================
//  Edge Function : auth-login
//  POST /functions/v1/auth-login
//  Body: { phone, password }
//
//  Stratégie sans Twilio : convertit le téléphone en email factice et utilise
//  le provider Email (gratuit) pour l'authentification.
// ===========================================================================
import { corsHeaders, withErrors, json, bad } from "../_shared/client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  if (!phone || !body.password) return bad("Numéro ou mot de passe incorrect.");

  const fakeEmail = `${phone}@phone.local`;

  const pub = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  // Login via le provider Email (téléphone converti en email factice).
  const { data, error } = await pub.auth.signInWithPassword({
    email: fakeEmail,
    password: String(body.password),
  });
  if (error || !data.session) return bad("Numéro ou mot de passe incorrect.", 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: profile } = await admin
    .from("profiles").select("*").eq("id", data.user.id).single();
  const { data: wallet } = await admin
    .from("wallets").select("*").eq("user_id", data.user.id).single();

  return json({
    access: data.session.access_token,
    refresh: data.session.refresh_token,
    user: {
      id: profile.id, phone: profile.phone, display_name: profile.display_name ?? "",
      balance: wallet ? String(wallet.balance) : "0",
      available_balance: wallet ? String(Number(wallet.balance) - Number(wallet.locked_balance)) : "0",
      locked_balance: wallet ? String(wallet.locked_balance) : "0",
      is_platform_admin: !!(profile.is_staff || profile.is_superuser),
      date_joined: profile.created_at,
    },
  });
}

Deno.serve(withErrors(handler));
