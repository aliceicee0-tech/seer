// ===========================================================================
//  Edge Function : auth-refresh
//  POST /functions/v1/auth-refresh
//  Body: { refresh }
//  Reproduit accounts/views.py RefreshTokenView.
//
//  Enveloppe le refresh natif Supabase Auth pour garder la compat frontend
//  (qui attend { access, refresh } en retour).
// ===========================================================================
import { corsHeaders, withErrors, json, bad } from "../_shared/client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad("Méthode non autorisée.", 405);

  const body = await req.json().catch(() => null);
  if (!body?.refresh) return bad("refresh manquant.");

  const pub = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  const { data, error } = await pub.auth.refreshSession({
    refresh_token: String(body.refresh),
  });

  if (error || !data.session) {
    return bad("Token invalide ou expiré.", 401);
  }

  return json({
    access: data.session.access_token,
    refresh: data.session.refresh_token,
  });
}

Deno.serve(withErrors(handler));
