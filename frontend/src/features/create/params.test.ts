import { beforeEach, describe, expect, it } from "vitest";
import type { Catalog, Job } from "../../api/types";
import { buildParams, reuseJob, validate } from "./params";
import { useCreate, type CreateState } from "./store";

const defaults: Catalog["defaults"] = {
  standard: { width: 1080, height: 1920, sampler: { steps: 8, cfg: 1, sampler_name: "er_sde", scheduler: "simple", denoise: 1 } },
  detailed: {
    width: 1920,
    height: 1080,
    pass1: { steps: 8, cfg: 1, sampler_name: "er_sde", scheduler: "simple", denoise: 1 },
    pass2: { steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 0.3 },
    turbo_pass1: { on: true, strength: 0.2 },
    turbo_pass2: { on: true, strength: 0.2 },
  },
  moss: {
    width: 1920,
    height: 1088,
    sampler: { steps: 8, cfg: 1, sampler_name: "er_sde", scheduler: "bong_tangent", denoise: 1 },
    turbo_lora: { on: true, strength: 1 },
    sft_lora: { on: true, strength: 1 },
    sharpen_strength: 0.7,
  },
  sharpen_strength: 0.75,
  t_enhancer_strength: 1,
  variance: { variance_preset: "Balanced" },
  edit: {} as Catalog["defaults"]["edit"], // not used by the Create tests
};

const state = (over: Partial<CreateState> = {}): CreateState => ({ ...useCreate.getState(), prompt: "a fox", ...over });

beforeEach(() => {
  useCreate.getState().reset();
  useCreate.getState().patch({ prompt: "" });
});

describe("buildParams", () => {
  it("sends the workflow defaults without any overrides (Standard)", () => {
    expect(buildParams(state(), defaults)).toEqual({
      mode: "create",
      variant: "standard",
      prompt: "a fox",
      width: 1080,
      height: 1920,
      batch: 1,
      seed_variance: true,
      t_enhancer: false,
      sharpen: true,
    });
  });

  it("uses the Detailed size and always sends upscale + save_first_pass", () => {
    const p = buildParams(state({ variant: "detailed" }), defaults);
    expect(p).toMatchObject({ variant: "detailed", width: 1920, height: 1080, upscale: 1, save_first_pass: true });
    expect(p).not.toHaveProperty("turbo_pass1");
  });

  it("sends only changed values and fills the rest of a turbo override from the workflow default", () => {
    const p = buildParams(
      state({ variant: "detailed", pass2: { steps: 6 }, turbo1: { strength: 0.4 }, sharpenStrength: 0.5, upscale: 1.5 }),
      defaults,
    );
    expect(p.pass2).toEqual({ steps: 6 });
    expect(p).not.toHaveProperty("pass1");
    expect(p.turbo_pass1).toEqual({ on: true, strength: 0.4 });
    expect(p.sharpen_strength).toBe(0.5);
    expect(p.upscale).toBe(1.5);
  });

  it("drops strengths and variance of toggles that are off", () => {
    const p = buildParams(state({ sharpen: false, tEnhancer: false, seedVariance: false, sharpenStrength: 0.5, variance: { fade_curve: "Linear" } }), defaults);
    expect(p).not.toHaveProperty("sharpen_strength");
    expect(p).not.toHaveProperty("variance");
  });

  it("sends seeds only while locked, per variant", () => {
    const seeds = { main: 1, pass2: 2, variance: 3 };
    expect(buildParams(state({ seeds }), defaults)).not.toHaveProperty("seed");
    expect(buildParams(state({ seeds, lockSeed: true }), defaults)).toMatchObject({ seed: 1, seed_variance_seed: 3 });
    const d = buildParams(state({ seeds, lockSeed: true, variant: "detailed", seedVariance: false }), defaults);
    expect(d).toMatchObject({ seed: 1, seed_pass2: 2 });
    expect(d).not.toHaveProperty("seed_variance_seed");
  });

  it("sends LoRA pass targets only in Detailed", () => {
    const loras = [{ name: "krea2/a.safetensors", strength: 0.8, on: true, target: "pass2" as const }];
    expect(buildParams(state({ loras }), defaults).loras).toEqual([{ name: "krea2/a.safetensors", strength: 0.8, on: true }]);
    expect(buildParams(state({ loras, variant: "detailed" }), defaults).loras).toEqual([
      { name: "krea2/a.safetensors", strength: 0.8, on: true, target: "pass2" },
    ]);
  });
});

describe("validate", () => {
  it("needs a prompt and sizes in range, multiple of 8", () => {
    expect(validate(state({ prompt: "  " }))).toMatch(/Describe/);
    expect(validate(state())).toBeNull();
    const sizes = { ...useCreate.getState().sizes, standard: { aspect: "custom", w: 1001, h: 512 } };
    expect(validate(state({ sizes }))).toMatch(/multiples of 8/);
  });
});

describe("MOSS Image", () => {
  it("sends only what MOSS takes: no variance, T-Enhancer, passes or upscale", () => {
    const p = buildParams(state({ variant: "moss", seedVariance: true, tEnhancer: true }), defaults);
    expect(p).toEqual({ mode: "create", variant: "moss", prompt: "a fox", width: 1920, height: 1088, batch: 1, sharpen: true });
  });

  it("sends its own sampler overrides, strength, seed and LoRAs without a pass target", () => {
    const loras = [{ name: "moss/x.safetensors", strength: 0.5, on: true, target: "pass1" as const }];
    const p = buildParams(state({ variant: "moss", mossSampler: { steps: 6 }, sampler: { steps: 99 }, sharpenStrength: 0.4, lockSeed: true, seeds: { main: 5, pass2: 6, variance: 7 }, loras }), defaults);
    expect(p).toMatchObject({ sampler: { steps: 6 }, sharpen_strength: 0.4, seed: 5, loras: [{ name: "moss/x.safetensors", strength: 0.5, on: true }] });
    expect(p).not.toHaveProperty("seed_pass2");
    expect((p.loras as object[])[0]).not.toHaveProperty("target");
  });

  it("sends the turbo and SFT LoRAs only when they differ from the workflow's on at 1", () => {
    expect(buildParams(state({ variant: "moss" }), defaults)).not.toHaveProperty("turbo_lora");
    const p = buildParams(state({ variant: "moss", mossTurbo: { on: false }, mossSft: { strength: 0.6 } }), defaults);
    expect(p).toMatchObject({ turbo_lora: { on: false, strength: 1 }, sft_lora: { on: true, strength: 0.6 } });
  });

  it("has its own 16 px size rule and default size", () => {
    expect(useCreate.getState().sizes.moss).toEqual({ aspect: "16:9", w: 1920, h: 1088 });
    expect(validate(state({ variant: "moss" }))).toBeNull();
    expect(validate(state({ variant: "moss", sizes: { ...useCreate.getState().sizes, moss: { aspect: "custom", w: 1000, h: 1088 } } }))).toMatch(/multiples of 16/);
    expect(validate(state({ variant: "standard", sizes: { ...useCreate.getState().sizes, standard: { aspect: "custom", w: 1000, h: 1088 } } }))).toBeNull();
  });

  it("reuse restores the MOSS settings and leaves Krea's toggles alone", () => {
    useCreate.getState().patch({ seedVariance: true, tEnhancer: true, sampler: { steps: 3 } });
    const job = {
      id: "j",
      params: { mode: "create", variant: "moss", prompt: "p", width: 1440, height: 1440, batch: 2, sharpen: false, sampler: { steps: 6, cfg: 1, sampler_name: "er_sde", scheduler: "bong_tangent", denoise: 1 } },
      seeds: { main: 9 },
    } as unknown as Job;
    reuseJob(job, defaults);
    const s = useCreate.getState();
    expect(s.variant).toBe("moss");
    expect(s.sizes.moss).toEqual({ aspect: "1:1", w: 1440, h: 1440 });
    expect(s.mossSampler).toEqual({ steps: 6 });
    expect(s.mossTurbo).toEqual({});
    expect(s.sampler).toEqual({ steps: 3 });
    expect(s.seedVariance && s.tEnhancer).toBe(true);
    expect(s.lockSeed).toBe(true);
    expect(s.seeds.main).toBe(9);
  });
});

describe("reuseJob", () => {
  it("restores parameters and every seed from a finished job", () => {
    const job = {
      id: "j",
      params: {
        mode: "create",
        variant: "detailed",
        prompt: "p",
        width: 1248,
        height: 1664,
        batch: 2,
        seed_variance: true,
        t_enhancer: true,
        sharpen: false,
        pass2: { steps: 6, cfg: null, sampler_name: "euler", scheduler: null, denoise: null },
        turbo_pass1: { on: false, strength: 0.2 },
        upscale: 1.25,
        save_first_pass: false,
        loras: [{ name: "x.safetensors", strength: 0.5, on: true, target: "pass1" }],
      },
      seeds: { pass1: 11, pass2: 22, variance: 33 },
    } as unknown as Job;
    reuseJob(job, defaults);
    const s = useCreate.getState();
    expect(s.variant).toBe("detailed");
    expect(s.sizes.detailed).toEqual({ aspect: "3:4", w: 1248, h: 1664 });
    expect(s.pass2).toEqual({ steps: 6 }); // sampler_name equals the default, nulls dropped
    expect(s.lockSeed).toBe(true);
    expect(s.seeds).toEqual({ main: 11, pass2: 22, variance: 33 });
    expect(s.upscale).toBe(1.25);
    expect(s.saveFirstPass).toBe(false);
    // Round trip: the rebuilt request carries the same seeds and settings.
    expect(buildParams(s, defaults)).toMatchObject({ seed: 11, seed_pass2: 22, seed_variance_seed: 33, batch: 2, turbo_pass1: { on: false, strength: 0.2 } });
  });

  it("keeps the settings but drops every seed when asked for a new seed", () => {
    const job = { id: "j", params: { mode: "create", prompt: "p" }, seeds: { pass1: 11, pass2: 22, variance: 33 } } as unknown as Job;
    reuseJob(job, defaults, false);
    const s = useCreate.getState();
    expect(s.prompt).toBe("p");
    expect(s.lockSeed).toBe(false);
    expect(s.seeds).toEqual({ main: null, pass2: null, variance: null });
  });
});

describe("style", () => {
  it("combines the manual prompt with the style text", () => {
    expect(buildParams(state(), defaults, "Soft watercolor.").prompt).toBe("a fox. Soft watercolor.");
    expect(buildParams(state(), defaults).prompt).toBe("a fox");
  });
});
