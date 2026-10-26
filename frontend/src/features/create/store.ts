import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SamplerDefaults } from "../../api/types";
import { ASPECTS, ASPECTS_MOSS, CUSTOM } from "../../lib/aspects";
import type { LoraSel } from "../../components/LoraList";
import type { LoraMode } from "../../lib/loras";
import { GRAIN_DEFAULT } from "../edit/grain";
import { STYLE_OPTS, type StyleOpts } from "./styles";

export type { LoraSel, LoraTarget } from "../../components/LoraList";

export type Variant = "standard" | "detailed" | "moss";

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
  /** a style from the library; its compact text is appended to the prompt when generating */
  style: { id: string; name: string } | null;
  styleOpts: StyleOpts;
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
  /** MOSS Image keeps its own sampler overrides: its defaults differ from Krea's. */
  mossSampler: Partial<SamplerDefaults>;
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

const mossPreset = (key: string): SizeSel => {
  const a = ASPECTS_MOSS.find((x) => x.key === key)!;
  return { aspect: a.key, w: a.w, h: a.h };
};

const initial = (): Omit<CreateState, "patch" | "reset"> => ({
  variant: "standard",
  prompt: "",
  style: null,
  styleOpts: STYLE_OPTS,
  sizes: { standard: preset("9:16"), detailed: preset("16:9"), moss: mossPreset("16:9") },
  batch: 1,
  seedVariance: true,
  tEnhancer: false,
  sharpen: true,
  grain: { on: false, strength: GRAIN_DEFAULT },
  variance: {},
  sampler: {},
  mossSampler: {},
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
      // Keep the prompt, style and remembered LoRA modes; everything else returns to the workflow defaults.
      reset: () => set((s) => ({ ...initial(), prompt: s.prompt, style: s.style, styleOpts: s.styleOpts, loraLastMode: s.loraLastMode, variant: s.variant })),
    }),
    {
      name: "accio.create",
      version: 4,
      // v2: styleOpts lost its "name" option. v3: it lost "compact" too (the compact text is the only one), keeping just "first".
      // v4: MOSS Image arrived: it has its own size and sampler overrides.
      migrate: (state) => {
        const old = state as { styleOpts?: { first?: boolean }; sizes?: Record<string, SizeSel> };
        return {
          ...(state as object),
          styleOpts: { ...STYLE_OPTS, first: old.styleOpts?.first === true },
          sizes: { ...old.sizes, moss: old.sizes?.moss ?? mossPreset("16:9") },
          mossSampler: {},
        } as CreateState;
      },
      partialize: ({ patch: _p, reset: _r, ...rest }) => rest,
    },
  ),
);

export const sizeOf = (s: CreateState) => s.sizes[s.variant];
export { CUSTOM };
