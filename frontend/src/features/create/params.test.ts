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
  sharpen_strength: 0.75,
  t_enhancer_strength: 1,
  variance: { variance_preset: "Balanced" },
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
});
