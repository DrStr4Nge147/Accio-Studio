import { create } from "zustand";
import { fetchAuthStatus, logout as apiLogout, type AuthStatus } from "../api/endpoints";
import { setAuthLostHandler } from "../api/http";

interface AuthState {
  /** null until the first status answer. */
  status: AuthStatus | null;
  /** True when the server could not be reached at all. */
  unreachable: boolean;
  refresh: () => Promise<void>;
  /** The server rejected our session: show the login screen. */
  lost: () => void;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: null,
  unreachable: false,
  refresh: async () => {
    try {
      set({ status: await fetchAuthStatus(), unreachable: false });
    } catch {
      set({ unreachable: true });
    }
  },
  lost: () => {
    const s = get().status;
    if (s?.authenticated !== false) set({ status: { configured: s?.configured ?? true, authenticated: false, setup_code_needed: false } });
  },
  signOut: async () => {
    try {
      await apiLogout();
    } finally {
      await get().refresh();
    }
  },
}));

setAuthLostHandler(() => useAuth.getState().lost());
