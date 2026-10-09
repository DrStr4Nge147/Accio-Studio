import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SamplerDefaults } from "../../api/types";
import { ASPECTS, CUSTOM } from "../../lib/aspects";
import type { LoraSel } from "../../components/LoraList";
import type { LoraMode } from "../../lib/loras";
import { GRAIN_DEFAULT } from "../edit/grain";

export type { LoraSel, LoraTarget } from "../../components/LoraList";

export type Variant = "standard" | "detailed";

export interface SizeSel {
  aspect: string; // an ASPECTS key or CUSTOM
  w: number;
  h: number;
}
export interface Seeds {
  main: number | null; // Standard: seed node. Detailed: pass 1.
  pass2: number | null;
  variance: number | null;
}

/** Everything the Create composer holds. Workflow defaults are not stored: an unset override means "the workflow's value". */
export interface CreateState {
  variant: Variant;
  prompt: string;
  sizes: Record<Variant, SizeSel>;
  batch: number;
  seedVariance: boolean;
  tEnhancer: boolean;
  sharpen: boolean;
  sharpenStrength?: number;
  tEnhancerStrength?: number;
  /** film grain added to the saved result */
  grain: { on: boolean; strength: number };
  variance: Record<string, string | number>;
  sampler: Partial<SamplerDefaults>;
  pass1: Partial<SamplerDefaults>;
  pass2: Partial<SamplerDefaults>;
  turbo1: { on?: boolean; strength?: number };
  turbo2: { on?: boolean; strength?: number };
  upscale: 1 | 1.25 | 1.5 | 2;
  saveFirstPass: boolean;
  lockSeed: boolean;
  seeds: Seeds;
  loras: LoraSel[];
  /** Which mode each LoRA was last used in (spec 6.6). */
  loraLastMode: Record<string, LoraMode>;
  patch: (p: Partial<Omit<CreateState, "patch" | "reset">>) => void;
  reset: () => void;
}

const preset = (key: string): SizeSel => {
  const a = ASPECTS.find((x) => x.key === key)!;
  return { aspect: a.key, w: a.w, h: a.h };
};

const initial = (): Omit<CreateState, "patch" | "reset"> => ({
  variant: "standard",
  prompt: "",
  sizes: { standard: preset("9:16"), detailed: preset("16:9") },
  batch: 1,
  seedVariance: true,
  tEnhancer: false,
  sharpen: true,
  grain: { on: false, strength: GRAIN_DEFAULT },
  variance: {},
  sampler: {},
  pass1: {},
  pass2: {},
  turbo1: {},
  turbo2: {},
  upscale: 1,
  saveFirstPass: true,
  lockSeed: false,
  seeds: { main: null, pass2: null, variance: null },
  loras: [],
  loraLastMode: {},
});

export const useCreate = create<CreateState>()(
  persist(
    (set) => ({
      ...initial(),
      patch: (p) => set(p),
      // Keep the prompt and remembered LoRA modes; everything else returns to the workflow defaults.
      reset: () => set((s) => ({ ...initial(), prompt: s.prompt, loraLastMode: s.loraLastMode, variant: s.variant })),
    }),
    {
      name: "accio.create",
      version: 1,
      partialize: ({ patch: _p, reset: _r, ...rest }) => rest,
    },
  ),
);

export const sizeOf = (s: CreateState) => s.sizes[s.variant];
export { CUSTOM };
