// ===========================================================================
//  Nexus v2 — Client API (Supabase Edge Functions)
//
//  Adaptation du client v1 (Django REST) vers les Edge Functions Supabase.
//  L'objet `api` garde EXACTEMENT la même interface → aucune page à modifier.
//
//  Différences clés vs v1 :
//    - BASE_URL vient de VITE_API_URL (ex: https://xxx.supabase.co/functions/v1)
//    - Les réponses tableaux sont enveloppées dans { count, results } pour
//      respecter le type Paginated<T> attendu par les pages.
//    - Les routes /create/ et /declare/ deviennent un POST sur la collection.
// ===========================================================================
import type {
  AdminDeposit, AdminLedgerEntry, AdminStats, AdminUser, AdminWithdraw,
  AuthResponse, Bet, CommissionConfig, DepositRequest, LedgerEntry, Market, MarketPool,
  MobileMoneyInfo, Outcome, Paginated, ReferralInfo, WithdrawRequest,
} from "./types";

// Base URL des Edge Functions Supabase (configurable via .env Vite).
const BASE = import.meta.env.VITE_API_URL ?? "/api";

// Codes de statut HTTP utilisés par le client API.
const HTTP_UNAUTHORIZED = 401;  // token expiré → tente un refresh
const HTTP_NO_CONTENT = 204;     // succès sans corps (DELETE, etc.)

// --- Gestion des tokens ----------------------------------------------------
const ACCESS_KEY = "seer_access";
const REFRESH_KEY = "seer_refresh";

export const token = {
  get access() {
    return localStorage.getItem(ACCESS_KEY) ?? "";
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY) ?? "";
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Extrait le message lisible d'une erreur d'API.
 *
 * Le backend (Django REST comme les Edge Functions Supabase) renvoie le détail
 * dans `{ detail: "..." }`. Sans cet helper, les `catch` affichaient des
 * messages génériques ("Création impossible.") qui masquaient la vraie cause.
 */
export function apiErrorMessage(e: unknown, fallback = "Une erreur est survenue."): string {
  if (e instanceof ApiError) {
    const d = e.detail as { detail?: unknown } | null;
    if (d && typeof d.detail === "string" && d.detail.trim()) return d.detail.trim();
    return e.message; // "Erreur 401", "Erreur 500", etc.
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

async function request<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (opts.auth !== false && token.access) {
    headers["Authorization"] = `Bearer ${token.access}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  if (res.status === HTTP_UNAUTHORIZED && token.refresh) {
    // Tente un rafraîchissement silencieux une fois
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers["Authorization"] = `Bearer ${token.access}`;
      const retry = await fetch(`${BASE}${path}`, { ...opts, headers });
      if (retry.ok) return (await retry.json()) as T;
    }
    token.clear();
  }

  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      /* réponse non JSON */
    }
    throw new ApiError(`Erreur ${res.status}`, res.status, detail);
  }

  if (res.status === HTTP_NO_CONTENT) return {} as T;
  return (await res.json()) as T;
}

/** Enveloppe un tableau en Paginated<T> (compat frontend Django REST). */
function paginate<T>(arr: T[]): Paginated<T> {
  return { count: arr.length, next: null, previous: null, results: arr };
}

async function requestPaginated<T>(path: string, opts?: RequestInit & { auth?: boolean }): Promise<Paginated<T>> {
  const arr = await request<T[]>(path, opts);
  return paginate(Array.isArray(arr) ? arr : []);
}

async function tryRefresh(): Promise<boolean> {
  try {
    // Supabase : le refresh se fait via l'endpoint natif (POST /auth/v1/refresh)
    // encapsulé ici par simplicité. On appelle l'Edge Function si elle existe,
    // sinon on dépend du SDK. En pratique, le SDK Supabase gère ça ; ce code
    // est un garde-fou pour les tokens v1.
    const res = await fetch(`${BASE}/auth-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: token.refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    token.set(data.access, data.refresh);
    return true;
  } catch {
    return false;
  }
}

// --- API publique ----------------------------------------------------------
export const api = {
  // Auth
  register: (phone: string, password: string, display_name?: string, referral_code?: string) =>
    request<AuthResponse>("/auth-register", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ phone, password, display_name, referral_code }),
    }),
  login: (phone: string, password: string) =>
    request<AuthResponse>("/auth-login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ phone, password }),
    }),

  // Profil
  me: () => request<import("./types").User>("/me", { auth: true }),
  myLedger: () => requestPaginated<LedgerEntry>("/my-ledger", { auth: true }),

  // Parrainage
  referral: () => request<ReferralInfo>("/referrals", { auth: true }),

  // Marchés (catalogue + détail + pools pari mutuel)
  markets: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return requestPaginated<Market>(`/markets${qs ? `?${qs}` : ""}`);
  },
  market: (id: number) => request<Market>(`/markets/${id}`),
  marketPool: (id: number) => request<MarketPool>(`/markets/${id}/pool`),

  // Paris (pari mutuel)
  placeBet: (marketId: number, outcome: Outcome, amount: number) =>
    request<Bet>(`/markets-write/${marketId}/bet`, {
      method: "POST",
      body: JSON.stringify({ outcome, amount }),
    }),

  // Compte utilisateur
  myBets: (status?: string) =>
    requestPaginated<Bet>(
      `/my-trading/bets${status ? `?status=${status}` : ""}`
    ),

  // Paiements
  mobileMoney: () => request<MobileMoneyInfo>("/payments/mobile-money"),
  createDeposit: (amount: string, operator: string) =>
    request<DepositRequest>("/payments/deposits", {
      method: "POST",
      body: JSON.stringify({ amount, operator, sender_phone: "", operator_ref: "" }),
    }),
  declareDeposit: (id: number, sender_phone: string, operator_ref: string) =>
    request<DepositRequest>(`/payments/deposits/${id}/declare`, {
      method: "POST",
      body: JSON.stringify({ sender_phone, operator_ref }),
    }),
  deposits: () => requestPaginated<DepositRequest>("/payments/deposits"),
  createWithdraw: (amount: string, operator: string, recipient_phone: string) =>
    request<WithdrawRequest>("/payments/withdrawals", {
      method: "POST",
      body: JSON.stringify({ amount, operator, recipient_phone }),
    }),
  withdrawals: () => requestPaginated<WithdrawRequest>("/payments/withdrawals"),

  // --- Dashboard admin (staff only) -------------------------------------
  admin: {
    stats: () => request<AdminStats>("/admin/stats"),

    // Dépôts — rapprochement bancaire
    deposits: (status?: string) =>
      requestPaginated<AdminDeposit>(
        `/admin/deposits${status ? `?status=${status}` : ""}`
      ),
    approveDeposit: (id: number, note?: string) =>
      request<AdminDeposit>(`/admin/deposits/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ note: note ?? "" }),
      }),
    rejectDeposit: (id: number, note?: string) =>
      request<AdminDeposit>(`/admin/deposits/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ note: note ?? "" }),
      }),

    // Retraits — exécution manuelle
    withdrawals: (status?: string) =>
      requestPaginated<AdminWithdraw>(
        `/admin/withdrawals${status ? `?status=${status}` : ""}`
      ),
    payWithdraw: (id: number, operator_ref?: string, note?: string) =>
      request<AdminWithdraw>(`/admin/withdrawals/${id}/pay`, {
        method: "POST",
        body: JSON.stringify({ operator_ref: operator_ref ?? "", note: note ?? "" }),
      }),
    rejectWithdraw: (id: number, note?: string) =>
      request<AdminWithdraw>(`/admin/withdrawals/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ note: note ?? "" }),
      }),

    // Marchés — CRUD + résolution/annulation
    markets: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return requestPaginated<Market>(`/admin/markets${qs ? `?${qs}` : ""}`);
    },
    createMarket: (data: import("./types").MarketFormData) =>
      request<Market>("/admin/markets", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateMarket: (id: number, data: Partial<import("./types").MarketFormData>) =>
      request<Market>(`/admin/markets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    resolveMarket: (id: number, outcome: "YES" | "NO") =>
      request<Market>(`/admin/markets/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ outcome }),
      }),
    cancelMarket: (id: number) =>
      request<Market>(`/admin/markets/${id}/cancel`, { method: "POST" }),
    deleteMarket: (id: number) =>
      request<{ ok: boolean }>(`/admin/markets/${id}/delete`, { method: "POST" }),

    // Joueurs & comptabilité
    users: (q?: string) =>
      requestPaginated<AdminUser>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    ledger: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return requestPaginated<AdminLedgerEntry>(`/admin/ledger${qs ? `?${qs}` : ""}`);
    },

    // Commission plateforme (config + diagnostic)
    commission: () => request<CommissionConfig>("/admin/commission"),
    updateCommission: (data: { rate?: number; platform_user_id?: string | null }) =>
      request<CommissionConfig>("/admin/commission", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  },
};
