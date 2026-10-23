import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BuilderMode } from "./options";
import type { Selection } from "./buildPrompt";

/** What the prompt builder remembers between visits: the mode and, per mode, the chosen options and the extra details. */
interface BuilderState {
  mode: BuilderMode;
  selections: Record<BuilderMode, Selection>;
  extra: Record<BuilderMode, string>;
  setMode: (mode: BuilderMode) => void;
  setSelection: (mode: BuilderMode, selection: Selection) => void;
  setExtra: (mode: BuilderMode, text: string) => void;
}

export const useBuilder = create<BuilderState>()(
  persist(
    (set) => ({
      mode: "character",
      selections: { character: {}, scene: {} },
      extra: { character: "", scene: "" },
      setMode: (mode) => set({ mode }),
      setSelection: (mode, selection) => set((s) => ({ selections: { ...s.selections, [mode]: selection } })),
      setExtra: (mode, text) => set((s) => ({ extra: { ...s.extra, [mode]: text } })),
    }),
    {
      name: "accio.create.builder",
      version: 1,
      partialize: ({ mode, selections, extra }) => ({ mode, selections, extra }),
    },
  ),
);
