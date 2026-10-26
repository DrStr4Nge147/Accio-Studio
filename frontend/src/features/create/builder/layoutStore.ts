import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EMPTY_SCENE, type Region, type Scene } from "./ideogram";

/** What the layout builder remembers between visits: the scene fields and the boxes. */
interface LayoutState {
  scene: Scene;
  regions: Region[];
  selected: string | null;
  setScene: (p: Partial<Scene>) => void;
  setRegions: (regions: Region[]) => void;
  select: (id: string | null) => void;
  clear: () => void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      scene: EMPTY_SCENE,
      regions: [],
      selected: null,
      setScene: (p) => set((s) => ({ scene: { ...s.scene, ...p } })),
      setRegions: (regions) => set({ regions }),
      select: (selected) => set({ selected }),
      clear: () => set({ scene: EMPTY_SCENE, regions: [], selected: null }),
    }),
    {
      name: "accio.create.layout",
      version: 1,
      partialize: ({ scene, regions }) => ({ scene, regions }),
    },
  ),
);
