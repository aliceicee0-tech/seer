import type {
  AdminDeposit, AdminLedgerEntry, AdminStats, AdminUser, AdminWithdraw,
  AuthResponse, Bet, DepositRequest, Estimate, LedgerEntry, Market,
  MobileMoneyInfo, Paginated, WithdrawRequest,
} from "./types";

const BASE = "/api";

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

  if (res.status === 401 && token.refresh) {
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
      /* reponse non JSON */
    }
    throw new ApiError(`Erreur ${res.status}`, res.status, detail);
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh/`, {
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
  register: (phone: string, password: string, display_name?: string) =>
    request<AuthResponse>("/auth/register/", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ phone, password, display_name }),
    }),
  login: (phone: string, password: string) =>
    request<AuthResponse>("/auth/login/", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ phone, password }),
    }),

  // Profil
  me: () => request<import("./types").User>("/me/", { auth: true }),
  myLedger: () =>
    request<Paginated<LedgerEntry>>("/me/ledger/", { auth: true }),

  // Marchés
  markets: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<Paginated<Market>>(`/markets/${qs ? `?${qs}` : ""}`);
  },
  market: (id: number) => request<Market>(`/markets/${id}/`),
  estimate: (id: number, outcome: string, amount: string) =>
    request<Estimate>(
      `/markets/${id}/estimate/?outcome=${outcome}&amount=${amount}`
    ),
  placeBet: (id: number, outcome: string, amount: string) =>
    request<Bet>(`/markets/${id}/place-bet/`, {
      method: "POST",
      body: JSON.stringify({ outcome, amount }),
    }),
  myBets: () => request<Paginated<Bet>>("/markets/my-bets/"),
  myActiveBets: () => request<Paginated<Bet>>("/markets/my-bets/active/"),

  // Paiements
  mobileMoney: () => request<MobileMoneyInfo>("/payments/mobile-money/"),
  createDeposit: (amount: string, operator: string) =>
    request<DepositRequest>("/payments/deposits/create/", {
      method: "POST",
      body: JSON.stringify({ amount, operator }),
    }),
  declareDeposit: (id: number, sender_phone: string, operator_ref: string) =>
    request<DepositRequest>(`/payments/deposits/${id}/declare/`, {
      method: "POST",
      body: JSON.stringify({ sender_phone, operator_ref }),
    }),
  deposits: () => request<Paginated<DepositRequest>>("/payments/deposits/"),
  createWithdraw: (amount: string, operator: string, recipient_phone: string) =>
    request<WithdrawRequest>("/payments/withdrawals/create/", {
      method: "POST",
      body: JSON.stringify({ amount, operator, recipient_phone }),
    }),
  withdrawals: () => request<Paginated<WithdrawRequest>>("/payments/withdrawals/"),

  // --- Dashboard admin (staff only) -------------------------------------
  admin: {
    stats: () => request<AdminStats>("/admin/stats/"),

    // Dépôts — rapprochement bancaire
    deposits: (status?: string) =>
      request<Paginated<AdminDeposit>>(
        `/admin/deposits/${status ? `?status=${status}` : ""}`
      ),
    approveDeposit: (id: number, note?: string) =>
      request<AdminDeposit>(`/admin/deposits/${id}/approve/`, {
        method: "POST",
        body: JSON.stringify({ note: note ?? "" }),
      }),
    rejectDeposit: (id: number, note?: string) =>
      request<AdminDeposit>(`/admin/deposits/${id}/reject/`, {
        method: "POST",
        body: JSON.stringify({ note: note ?? "" }),
      }),

    // Retraits — exécution manuelle
    withdrawals: (status?: string) =>
      request<Paginated<AdminWithdraw>>(
        `/admin/withdrawals/${status ? `?status=${status}` : ""}`
      ),
    payWithdraw: (id: number, operator_ref?: string, note?: string) =>
      request<AdminWithdraw>(`/admin/withdrawals/${id}/pay/`, {
        method: "POST",
        body: JSON.stringify({ operator_ref: operator_ref ?? "", note: note ?? "" }),
      }),
    rejectWithdraw: (id: number, note?: string) =>
      request<AdminWithdraw>(`/admin/withdrawals/${id}/reject/`, {
        method: "POST",
        body: JSON.stringify({ note: note ?? "" }),
      }),

    // Marchés — CRUD + résolution/annulation
    markets: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request<Paginated<Market>>(`/admin/markets/${qs ? `?${qs}` : ""}`);
    },
    createMarket: (data: import("./types").MarketFormData) =>
      request<Market>("/admin/markets/", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateMarket: (id: number, data: Partial<import("./types").MarketFormData>) =>
      request<Market>(`/admin/markets/${id}/`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    resolveMarket: (id: number, outcome: "YES" | "NO") =>
      request<Market>(`/admin/markets/${id}/resolve/`, {
        method: "POST",
        body: JSON.stringify({ outcome }),
      }),
    cancelMarket: (id: number) =>
      request<Market>(`/admin/markets/${id}/cancel/`, { method: "POST" }),

    // Joueurs & comptabilité
    users: (q?: string) =>
      request<Paginated<AdminUser>>(`/admin/users/${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    ledger: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request<Paginated<AdminLedgerEntry>>(`/admin/ledger/${qs ? `?${qs}` : ""}`);
    },
  },
};
