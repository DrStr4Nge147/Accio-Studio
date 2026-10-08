import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SamplerDefaults } from "../../api/types";
import type { LoraSel } from "../../components/LoraList";
import type { LoraMode } from "../../lib/loras";
import { GRAIN_DEFAULT } from "./grain";
import { isKleinModel } from "./klein";

export type EditMode = "multiedit" | "inpaint" | "outpaint";
export type Seam = "classic" | "blend in";
export type FillMode = "color" | "edge" | "edge pixel" | "pillarbox blur" | "mirror";
export type CropKey = "context_factor" | "blend_pixels" | "mask_grow" | "mask_blur" | "context_pixels" | "output_multiple" | "target_megapixels";

export const EDIT_MODES: { value: EditMode; label: string; short: string }[] = [
  { value: "multiedit", label: "Multi-edit", short: "Multi" },
  { value: "inpaint", label: "Inpaint", short: "Inpaint" },
  { value: "outpaint", label: "Outpaint", short: "Outpaint" },
];

export interface MultiState {
  keepOriginal: boolean;
  pixelDrift: boolean;
  /** Pixel Drift Fix was switched off by turning Manual size on (it would resize the result back); turning Manual size off restores it */
  driftAuto?: boolean;
  manualSize: boolean;
  manualW: number;
  manualH: number;
  /** undefined = the workflow's value (1 MP) */
  baseMp?: number;
  /** reference image n (0 = image 2) megapixels overrides */
  refMp: Record<number, number>;
  preset: "head" | "body" | null;
}
export interface InpaintState {
  invert: boolean;
  halo: boolean;
  seam?: Seam;
  crop: Partial<Record<CropKey, number>>;
  preset: "remove" | "move" | null;
  /** brush diameter as % of the image's shorter side */
  brush: number;
}
export interface OutpaintState {
  fillMode: FillMode;
  fillColor: string;
  blur?: number;
  feather?: number;
  targetMp?: number;
  halo: boolean;
  seam?: Seam;
  loraOn: boolean;
  loraStrength?: number;
}

export interface GrainState {
  on: boolean;
  strength: number;
}

export interface EditSettings {
  mode: EditMode;
  /** film grain added to the saved result, same for every Edit mode */
  grain: GrainState;
  /** diffusion model for every Edit mode; undefined = the workflow's own */
  model?: string;
  /** sampler settings saved per model name, restored when that model is chosen again */
  modelPresets: Record<string, Record<EditMode, Partial<SamplerDefaults>>>;
  prompts: Record<EditMode, string>;
  enhancer: { multiedit: boolean; inpaint: boolean };
  multi: MultiState;
  inpaint: InpaintState;
  outpaint: OutpaintState;
  sampler: Record<EditMode, Partial<SamplerDefaults>>;
  lockSeed: Record<EditMode, boolean>;
  seeds: Record<EditMode, number | null>;
  loras: Record<EditMode, LoraSel[]>;
  loraLastMode: Record<string, LoraMode>;
}

interface EditActions {
  patch: (p: Partial<EditSettings>) => void;
  /** choose the model; a preset saved for it puts its sampler settings back */
  setModel: (model: string | undefined) => void;
  /** remember the current sampler settings (all modes) for the chosen model */
  saveModelPreset: () => void;
  setGrain: (p: Partial<GrainState>) => void;
  setMulti: (p: Partial<MultiState>) => void;
  /** Manual size on turns Pixel Drift Fix off (the user can turn it back on); off restores what was switched off */
  setManualSize: (on: boolean) => void;
  /** an explicit choice by the user: forget that it was switched off automatically */
  setPixelDrift: (on: boolean) => void;
  setInpaint: (p: Partial<InpaintState>) => void;
  setOutpaint: (p: Partial<OutpaintState>) => void;
  setPrompt: (mode: EditMode, text: string) => void;
  setSampler: (mode: EditMode, s: Partial<SamplerDefaults>) => void;
  setLoras: (mode: EditMode, l: LoraSel[]) => void;
  setSeed: (mode: EditMode, lock: boolean, seed: number | null) => void;
  /** back to workflow defaults for one mode; prompt and remembered LoRA modes stay */
  reset: (mode: EditMode) => void;
}

const perMode = <T,>(v: () => T): Record<EditMode, T> => ({ multiedit: v(), inpaint: v(), outpaint: v() });

export const initialMulti = (): MultiState => ({
  keepOriginal: false,
  pixelDrift: true,
  manualSize: false,
  manualW: 1024,
  manualH: 1024,
  refMp: {},
  preset: null,
});
export const initialInpaint = (): InpaintState => ({ invert: false, halo: false, crop: {}, preset: null, brush: 4 });
export const initialOutpaint = (): OutpaintState => ({ fillMode: "color", fillColor: "#808080", halo: false, loraOn: true });

const initial = (): EditSettings => ({
  mode: "multiedit",
  grain: { on: false, strength: GRAIN_DEFAULT },
  modelPresets: {},
  prompts: { multiedit: "", inpaint: "", outpaint: "" },
  enhancer: { multiedit: true, inpaint: true },
  multi: initialMulti(),
  inpaint: initialInpaint(),
  outpaint: initialOutpaint(),
  sampler: perMode(() => ({})),
  lockSeed: perMode(() => false),
  seeds: perMode(() => null),
  loras: perMode(() => []),
  loraLastMode: {},
});

export const useEdit = create<EditSettings & EditActions>()(
  persist(
    (set) => ({
      ...initial(),
      patch: (p) => set(p),
      setModel: (model) =>
        set((s) => {
          const preset = model ? s.modelPresets[model] : undefined;
          if (preset) return { model, sampler: structuredClone(preset) };
          // Klein and Qwen have different sampler defaults: overrides made against one make no sense on the other.
          return isKleinModel(model) !== isKleinModel(s.model) ? { model, sampler: perMode(() => ({})) } : { model };
        }),
      saveModelPreset: () =>
        set((s) => (s.model ? { modelPresets: { ...s.modelPresets, [s.model]: structuredClone(s.sampler) } } : {})),
      setGrain: (p) => set((s) => ({ grain: { ...s.grain, ...p } })),
      setMulti: (p) => set((s) => ({ multi: { ...s.multi, ...p } })),
      setManualSize: (on) =>
        set((s) => {
          const m = s.multi;
          if (on) return { multi: { ...m, manualSize: true, pixelDrift: false, driftAuto: m.pixelDrift } };
          return { multi: { ...m, manualSize: false, pixelDrift: m.driftAuto ? true : m.pixelDrift, driftAuto: false } };
        }),
      setPixelDrift: (on) => set((s) => ({ multi: { ...s.multi, pixelDrift: on, driftAuto: false } })),
      setInpaint: (p) => set((s) => ({ inpaint: { ...s.inpaint, ...p } })),
      setOutpaint: (p) => set((s) => ({ outpaint: { ...s.outpaint, ...p } })),
      setPrompt: (mode, text) => set((s) => ({ prompts: { ...s.prompts, [mode]: text } })),
      setSampler: (mode, v) => set((s) => ({ sampler: { ...s.sampler, [mode]: v } })),
      setLoras: (mode, l) => set((s) => ({ loras: { ...s.loras, [mode]: l } })),
      setSeed: (mode, lock, seed) => set((s) => ({ lockSeed: { ...s.lockSeed, [mode]: lock }, seeds: { ...s.seeds, [mode]: seed } })),
      reset: (mode) =>
        set((s) => {
          const base = initial();
          return {
            multi: mode === "multiedit" ? base.multi : s.multi,
            inpaint: mode === "inpaint" ? { ...base.inpaint, brush: s.inpaint.brush } : s.inpaint,
            outpaint: mode === "outpaint" ? base.outpaint : s.outpaint,
            enhancer: { ...s.enhancer, ...(mode !== "outpaint" ? { [mode]: true } : {}) },
            sampler: { ...s.sampler, [mode]: {} },
            lockSeed: { ...s.lockSeed, [mode]: false },
            seeds: { ...s.seeds, [mode]: null },
            loras: { ...s.loras, [mode]: [] },
          };
        }),
    }),
    {
      name: "accio.edit",
      version: 1,
      partialize: (s) => ({
        mode: s.mode,
        grain: s.grain,
        model: s.model,
        modelPresets: s.modelPresets,
        prompts: s.prompts,
        enhancer: s.enhancer,
        multi: s.multi,
        inpaint: s.inpaint,
        outpaint: s.outpaint,
        sampler: s.sampler,
        lockSeed: s.lockSeed,
        seeds: s.seeds,
        loras: s.loras,
        loraLastMode: s.loraLastMode,
      }),
    },
  ),
);
