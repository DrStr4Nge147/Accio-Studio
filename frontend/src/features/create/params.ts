import type { Catalog, Job, SamplerDefaults } from "../../api/types";
import { ASPECTS, ASPECTS_MOSS, CUSTOM, MAX_DIM, MIN_DIM } from "../../lib/aspects";
import { useCreate, type CreateState, type LoraSel, type Variant } from "./store";
import { withStyle } from "./styles";

type Defaults = Catalog["defaults"];

const nonEmpty = <T extends object>(o: T) => (Object.keys(o).length ? o : undefined);

export function validate(s: CreateState): string | null {
  if (!s.prompt.trim()) return "Describe what to create first.";
  const { w, h } = s.sizes[s.variant];
  const step = s.variant === "moss" ? 16 : 8; // MOSS Image's VAE works in 16 px steps
  for (const d of [w, h]) {
    if (!Number.isInteger(d) || d % step !== 0 || d < MIN_DIM || d > MAX_DIM) {
      return `Width and height must be multiples of ${step} between ${MIN_DIM} and ${MAX_DIM}.`;
    }
  }
  return null;
}

/** The request body for POST /api/jobs. Only values the user changed are sent as overrides. */
export function buildParams(s: CreateState, d: Defaults | null, styleText?: string): Record<string, unknown> {
  const { w, h } = s.sizes[s.variant];
  if (s.variant === "moss") return buildMoss(s, d, w, h, styleText);
  const p: Record<string, unknown> = {
    mode: "create",
    variant: s.variant,
    prompt: withStyle(s.prompt, styleText, s.styleOpts.first),
    width: w,
    height: h,
    batch: s.batch,
    seed_variance: s.seedVariance,
    t_enhancer: s.tEnhancer,
    sharpen: s.sharpen,
  };
  if (s.sharpen && s.sharpenStrength !== undefined) p.sharpen_strength = s.sharpenStrength;
  if (s.tEnhancer && s.tEnhancerStrength !== undefined) p.t_enhancer_strength = s.tEnhancerStrength;
  if (s.seedVariance && nonEmpty(s.variance)) p.variance = s.variance;
  if (s.grain.on) p.film_grain = s.grain.strength;

  if (s.variant === "standard") {
    if (nonEmpty(s.sampler)) p.sampler = s.sampler;
  } else {
    if (nonEmpty(s.pass1)) p.pass1 = s.pass1;
    if (nonEmpty(s.pass2)) p.pass2 = s.pass2;
    for (const [key, ov, def] of [
      ["turbo_pass1", s.turbo1, d?.detailed.turbo_pass1],
      ["turbo_pass2", s.turbo2, d?.detailed.turbo_pass2],
    ] as const) {
      if (nonEmpty(ov) && def) p[key] = { on: ov.on ?? def.on, strength: ov.strength ?? def.strength };
    }
    p.upscale = s.upscale;
    p.save_first_pass = s.saveFirstPass;
  }

  if (s.lockSeed) {
    if (s.seeds.main !== null) p.seed = s.seeds.main;
    if (s.variant === "detailed" && s.seeds.pass2 !== null) p.seed_pass2 = s.seeds.pass2;
    if (s.seedVariance && s.seeds.variance !== null) p.seed_variance_seed = s.seeds.variance;
  }
  if (s.loras.length) {
    p.loras = s.loras.map((l) => ({
      name: l.name,
      strength: l.strength,
      on: l.on,
      ...(s.variant === "detailed" ? { target: l.target } : {}),
    }));
  }
  return p;
}

/** The sampler values MOSS shows as its defaults: with the turbo LoRA off, the workflow's normal steps and CFG replace the turbo ones. */
export function mossSamplerDefaults(d: Defaults | undefined, turboOn: boolean): SamplerDefaults | undefined {
  if (!d) return undefined;
  return turboOn ? d.moss.sampler : { ...d.moss.sampler, ...d.moss.base_sampler };
}

/** MOSS Image: one pass, no variance or T-Enhancer (the server refuses those for it). */
function buildMoss(s: CreateState, d: Defaults | null, w: number, h: number, styleText?: string): Record<string, unknown> {
  const p: Record<string, unknown> = {
    mode: "create",
    variant: "moss",
    prompt: withStyle(s.prompt, styleText, s.styleOpts.first),
    width: w,
    height: h,
    batch: s.batch,
    sharpen: s.sharpen,
  };
  if (s.sharpen && s.sharpenStrength !== undefined) p.sharpen_strength = s.sharpenStrength;
  if (s.mossEnhance) p.prompt_enhancer = true;
  if (s.grain.on) p.film_grain = s.grain.strength;
  if (nonEmpty(s.mossSampler)) p.sampler = s.mossSampler;
  for (const [key, ov, def] of [
    ["turbo_lora", s.mossTurbo, d?.moss.turbo_lora],
    ["sft_lora", s.mossSft, d?.moss.sft_lora],
  ] as const) {
    if (nonEmpty(ov) && def) p[key] = { on: ov.on ?? def.on, strength: ov.strength ?? def.strength };
  }
  if (s.lockSeed && s.seeds.main !== null) p.seed = s.seeds.main;
  if (s.loras.length) p.loras = s.loras.map((l) => ({ name: l.name, strength: l.strength, on: l.on }));
  return p;
}

const diff = (from: Record<string, any> | null | undefined, def: SamplerDefaults | undefined): Partial<SamplerDefaults> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(from ?? {})) if (v !== null && v !== undefined && (!def || def[k as keyof SamplerDefaults] !== v)) out[k] = v;
  return out as Partial<SamplerDefaults>;
};

/** "Reuse settings": put a finished Create job's parameters and every seed back in the composer. */
export function reuseJob(job: Job, d: Defaults | null, keepSeed = true) {
  const p = job.params;
  if (p.mode !== "create") return;
  const variant: Variant = p.variant === "detailed" ? "detailed" : p.variant === "moss" ? "moss" : "standard";
  const w = p.width ?? d?.[variant].width ?? 1080;
  const h = p.height ?? d?.[variant].height ?? 1920;
  const match = (variant === "moss" ? ASPECTS_MOSS : ASPECTS).find((a) => a.w === w && a.h === h);
  const cur = useCreate.getState();
  if (variant === "moss") {
    // Only what MOSS Image has; Krea's own toggles and passes stay as they are.
    cur.patch({
      variant,
      prompt: p.prompt ?? "",
      style: null,
      sizes: { ...cur.sizes, moss: { aspect: match?.key ?? CUSTOM, w, h } },
      batch: p.batch ?? 1,
      sharpen: !!p.sharpen,
      sharpenStrength: p.sharpen_strength ?? undefined,
      grain: p.film_grain ? { on: true, strength: p.film_grain } : { ...cur.grain, on: false },
      mossSampler: diff(p.sampler, d?.moss.sampler),
      mossEnhance: p.prompt_enhancer === true,
      mossTurbo: p.turbo_lora ?? {},
      mossSft: p.sft_lora ?? {},
      loras: ((p.loras ?? []) as Partial<LoraSel>[]).map((l) => ({ name: String(l.name), strength: l.strength ?? 1, on: l.on ?? true, target: "both" as const })),
      lockSeed: keepSeed,
      seeds: keepSeed ? { ...cur.seeds, main: job.seeds.main ?? null } : { ...cur.seeds, main: null },
    });
    return;
  }
  const dd = d?.detailed;
  useCreate.getState().patch({
    variant,
    prompt: p.prompt ?? "",
    style: null,
    sizes: { ...cur.sizes, [variant]: { aspect: match?.key ?? CUSTOM, w, h } },
    batch: p.batch ?? 1,
    seedVariance: !!p.seed_variance,
    tEnhancer: !!p.t_enhancer,
    sharpen: !!p.sharpen,
    sharpenStrength: p.sharpen_strength ?? undefined,
    tEnhancerStrength: p.t_enhancer_strength ?? undefined,
    grain: p.film_grain ? { on: true, strength: p.film_grain } : { ...cur.grain, on: false },
    variance: p.variance ?? {},
    sampler: diff(p.sampler, d?.standard.sampler),
    pass1: diff(p.pass1, dd?.pass1),
    pass2: diff(p.pass2, dd?.pass2),
    turbo1: p.turbo_pass1 ?? {},
    turbo2: p.turbo_pass2 ?? {},
    upscale: p.upscale ?? 1,
    saveFirstPass: p.save_first_pass ?? true,
    loras: ((p.loras ?? []) as Partial<LoraSel>[]).map((l) => ({
      name: String(l.name),
      strength: l.strength ?? 1,
      on: l.on ?? true,
      target: l.target ?? "both",
    })),
    lockSeed: keepSeed,
    seeds: keepSeed
      ? {
          main: job.seeds.main ?? job.seeds.pass1 ?? null,
          pass2: job.seeds.pass2 ?? null,
          variance: job.seeds.variance ?? null,
        }
      : { main: null, pass2: null, variance: null },
  });
}
