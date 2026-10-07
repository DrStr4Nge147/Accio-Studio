import { create } from "zustand";
import { fetchCatalog, fetchHealth } from "../api/endpoints";
import type { Catalog, Health } from "../api/types";

interface ServerState {
  health: Health | null;
  /** True when /api/health itself could not be reached. */
  unreachable: boolean;
  catalog: Catalog | null;
  refreshHealth: () => Promise<void>;
  /** LoRAs are listed fresh from ComfyUI each time this runs (spec 6.6). */
  refreshCatalog: () => Promise<void>;
}

export const useServer = create<ServerState>((set) => ({
  health: null,
  unreachable: false,
  catalog: null,
  refreshHealth: async () => {
    try {
      set({ health: await fetchHealth(), unreachable: false });
    } catch {
      set({ unreachable: true });
    }
  },
  refreshCatalog: async () => {
    try {
      set({ catalog: await fetchCatalog() });
    } catch {
      /* ComfyUI offline: keep the previous catalog; the health banner explains why */
    }
  },
}));
