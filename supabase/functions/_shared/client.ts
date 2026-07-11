// ===========================================================================
//  Nexus v2 — Client Supabase + helpers partagés (Edge Functions)
//
//  Toutes les Edge Functions importent ce module pour :
//    - créer un client Supabase avec le contexte de l'utilisateur courant (JWT) ;
//    - créer un client admin (service role, court-circuite la RLS) ;
//    - parsing/réponse HTTP standardisés.
// ===========================================================================
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Headers CORS.
 * Note sécurité : le wildcard (*) est acceptable ici car l'authentification
 * repose sur un JWT Bearer en localStorage (pas en cookie httpOnly). Un site
 * tiers ne peut ni lire ce token ni forger des requêtes authentifiées.
 * Pour restreindre à un domaine précis en production (recommandé quand tu auras
 * ton domaine définitif), remplace "*" par l'URL du frontend.
 */
export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "vary": "origin",
};

export const SHARE_VALUE = Number(Deno.env.get("SHARE_VALUE") ?? 5000);
export const MIN_ORDER_PRICE = Number(Deno.env.get("MIN_ORDER_PRICE") ?? 1);
export const MAX_ORDER_PRICE = Number(Deno.env.get("MAX_ORDER_PRICE") ?? 4999);
export const PLATFORM_COMMISSION_RATE = Number(
  Deno.env.get("PLATFORM_COMMISSION_RATE") ?? 10,
);

/** Réponse JSON standardisée (avec headers CORS pour le navigateur). */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

/** Erreur 400 formatée (avec headers CORS). */
export function bad(msg: string, status = 400): Response {
  return json({ detail: msg }, status);
}

/** Extrait et valide le JWT Supabase depuis l'en-tête Authorization. */
export function requireAuth(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AuthError("Authentification requise.", 401);
  return match[1];
}

/** Client Supabase au nom de l'utilisateur courant (respecte la RLS). */
export function userClient(req: Request): SupabaseClient {
  const token = requireAuth(req);
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

/** Client admin (service role — court-circuite la RLS, usage réservé). */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export class AuthError extends Error {
  status: number;
  constructor(msg: string, status = 400) {
    super(msg);
    this.status = status;
  }
}

/** Récupère l'UUID de l'utilisateur courant (depuis le JWT décodé). */
export async function currentUserId(req: Request): Promise<string> {
  const sb = userClient(req);
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new AuthError("Session invalide.", 401);
  return data.user.id;
}

/** Vérifie que l'utilisateur courant est admin (staff/superuser). */
export async function requireAdmin(req: Request): Promise<string> {
  const uid = await currentUserId(req);
  const sb = adminClient();
  const { data, error } = await sb
    .from("profiles")
    .select("is_staff, is_superuser")
    .eq("id", uid)
    .single();
  if (error || !data || !(data.is_staff || data.is_superuser)) {
    throw new AuthError("Accès réservé aux administrateurs.", 403);
  }
  return uid;
}

/** Wrapper : exécute un handler en catchant les erreurs standardisées. */
export function withErrors(
  handler: (req: Request, ctx: unknown) => Promise<Response>,
): (req: Request, ctx: unknown) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof AuthError) return bad(e.message, e.status);
      console.error(e);
      return bad("Erreur serveur.", 500);
    }
  };
}
