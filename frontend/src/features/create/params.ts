import type { Catalog, Job, SamplerDefaults } from "../../api/types";
import { ASPECTS, CUSTOM, MAX_DIM, MIN_DIM } from "../../lib/aspects";
import { useCreate, type CreateState, type LoraSel, type Variant } from "./store";

type Defaults = Catalog["defaults"];

const nonEmpty = <T extends object>(o: T) => (Object.keys(o).length ? o : undefined);

export function validate(s: CreateState): string | null {
  if (!s.prompt.trim()) return "Describe what to create first.";
  const { w, h } = s.sizes[s.variant];
  for (const d of [w, h]) {
    if (!Number.isInteger(d) || d % 8 !== 0 || d < MIN_DIM || d > MAX_DIM) {
      return `Width and height must be multiples of 8 between ${MIN_DIM} and ${MAX_DIM}.`;
    }
  }
  return null;
}

/** The request body for POST /api/jobs. Only values the user changed are sent as overrides. */
export function buildParams(s: CreateState, d: Defaults | null): Record<string, unknown> {
  const { w, h } = s.sizes[s.variant];
  const p: Record<string, unknown> = {
    mode: "create",
    variant: s.variant,
    prompt: s.prompt.trim(),
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

const diff = (from: Record<string, any> | null | undefined, def: SamplerDefaults | undefined): Partial<SamplerDefaults> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(from ?? {})) if (v !== null && v !== undefined && (!def || def[k as keyof SamplerDefaults] !== v)) out[k] = v;
  return out as Partial<SamplerDefaults>;
};

/** "Reuse settings": put a finished Create job's parameters and every seed back in the composer. */
export function reuseJob(job: Job, d: Defaults | null, keepSeed = true) {
  const p = job.params;
  if (p.mode !== "create") return;
  const variant: Variant = p.variant === "detailed" ? "detailed" : "standard";
  const w = p.width ?? d?.[variant].width ?? 1080;
  const h = p.height ?? d?.[variant].height ?? 1920;
  const match = ASPECTS.find((a) => a.w === w && a.h === h);
  const cur = useCreate.getState();
  const dd = d?.detailed;
  useCreate.getState().patch({
    variant,
    prompt: p.prompt ?? "",
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
