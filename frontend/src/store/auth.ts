import { create } from "zustand";
import { api, token } from "../api/client";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  /** false tant que le profil n'a pas été rechargé (depuis le token) au démarrage. */
  initialized: boolean;
  loading: boolean;
  error: string | null;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  /** Recharge le profil depuis le token persistant (appelé une fois au boot). */
  bootstrap: () => Promise<void>;
  clearError: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  initialized: false,
  loading: false,
  error: null,

  login: async (phone, password) => {
    set({ loading: true, error: null });
    try {
      const res = await api.login(phone, password);
      token.set(res.access, res.refresh);
      set({ user: res.user, loading: false, initialized: true });
    } catch (e) {
      set({ loading: false, error: errMsg(e, "Connexion échouée.") });
      throw e;
    }
  },

  register: async (phone, password, name) => {
    set({ loading: true, error: null });
    try {
      const res = await api.register(phone, password, name);
      token.set(res.access, res.refresh);
      set({ user: res.user, loading: false, initialized: true });
    } catch (e) {
      set({ loading: false, error: errMsg(e, "Inscription échouée.") });
      throw e;
    }
  },

  logout: () => {
    token.clear();
    set({ user: null });
  },

  fetchMe: async () => {
    if (!token.access) {
      set({ user: null, initialized: true });
      return;
    }
    try {
      const user = await api.me();
      set({ user });
    } catch {
      token.clear();
      set({ user: null });
    }
  },

  bootstrap: async () => {
    if (get().initialized) return;
    await get().fetchMe();
    set({ initialized: true });
  },

  clearError: () => set({ error: null }),
}));

function errMsg(e: unknown, fallback: string): string {
  const any = e as { detail?: unknown };
  const d = any?.detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    // erreurs de validation DRF
    const first = Object.values(d)[0];
    if (Array.isArray(first)) return String(first[0]);
    return JSON.stringify(d);
  }
  return fallback;
}
