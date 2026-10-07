import { create } from "zustand";
import { fetchComfyLog } from "../api/endpoints";
import { appendLog } from "../lib/consoleLog";

interface ConsoleState {
  lines: string[];
  offset: number | null;
  /** false = no log to show (external backend, or the file does not exist yet). */
  available: boolean;
  external: boolean;
  poll: () => Promise<void>;
  clear: () => void;
}

export const useConsole = create<ConsoleState>((set, get) => ({
  lines: [],
  offset: null,
  available: true,
  external: false,
  poll: async () => {
    try {
      const r = await fetchComfyLog(get().offset);
      if (!r.available) return set({ available: false, external: !!r.external });
      set((s) => ({
        available: true,
        external: false,
        offset: r.offset,
        lines: r.text || r.reset ? appendLog(r.reset ? [] : s.lines, r.text) : s.lines,
      }));
    } catch {
      /* server unreachable: the health banner explains; try again on the next tick */
    }
  },
  clear: () => set({ lines: [] }),
}));
