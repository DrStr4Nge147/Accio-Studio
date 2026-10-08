import { beforeEach, describe, expect, it } from "vitest";
import type { EditDefaults, Job } from "../../api/types";
import { editBlocker, inpaintParams, multiParams, outpaintParams, reuseEditSettings } from "./params";
import { PRESETS } from "./presets";
import { useEdit } from "./store";
import type { Slot, Source } from "./workspace";

const slot = (over: Partial<Slot> = {}): Slot => ({ id: "a", name: "a.png", url: "blob:x", status: "ready", progress: 1, file: "f1.png", w: 2000, h: 1000, ...over });
const src: Source = { blob: new Blob(), url: "blob:s", w: 800, h: 600, name: "s.png" };
const noWs = {
  slots: [] as Slot[],
  inpaint: { src: null as Source | null, ops: [] as never[] },
  outpaint: { src: null as Source | null, pads: { l: 0, t: 0, r: 0, b: 0 }, upload: { status: "idle" } },
};

const state = () => useEdit.getState();
beforeEach(() => {
  for (const m of ["multiedit", "inpaint", "outpaint"] as const) state().reset(m);
  state().patch({ mode: "multiedit", model: undefined, modelPresets: {}, prompts: { multiedit: "", inpaint: "", outpaint: "" } });
});

describe("editBlocker", () => {
  it("multi-edit needs ready images and a prompt", () => {
    state().patch({ mode: "multiedit" });
    expect(editBlocker(state(), noWs)).toMatch(/Add at least one image/);
    expect(editBlocker(state(), { ...noWs, slots: [slot({ status: "uploading" })] })).toMatch(/Uploading/);
    expect(editBlocker(state(), { ...noWs, slots: [slot({ status: "error" })] })).toMatch(/failed/);
    expect(editBlocker(state(), { ...noWs, slots: [slot()] })).toMatch(/Describe/);
    state().setPrompt("multiedit", "make it night");
    expect(editBlocker(state(), { ...noWs, slots: [slot()] })).toBeNull();
  });

  it("head and body swap need two images", () => {
    state().setPrompt("multiedit", "x");
    state().setMulti({ preset: "head" });
    expect(editBlocker(state(), { ...noWs, slots: [slot()] })).toMatch(/second image/);
    expect(editBlocker(state(), { ...noWs, slots: [slot(), slot({ id: "b" })] })).toBeNull();
  });

  it("a manual size must be a multiple of 8", () => {
    state().setPrompt("multiedit", "x");
    state().setMulti({ manualSize: true, manualW: 1001 });
    expect(editBlocker(state(), { ...noWs, slots: [slot()] })).toMatch(/multiples of 8/);
  });

  it("inpaint needs an image, paint (or the preset's boxes) and a prompt", () => {
    state().patch({ mode: "inpaint" });
    expect(editBlocker(state(), noWs)).toMatch(/Choose an image/);
    const w = (ops: unknown[]) => ({ ...noWs, inpaint: { src, ops: ops as never[] } });
    const box = { t: "box", x: 0, y: 0, w: 9, h: 9 };
    const paint = { t: "stroke", erase: false, size: 5, pts: [1, 1] };
    expect(editBlocker(state(), w([]))).toMatch(/Paint/);
    state().setPrompt("inpaint", "a hat");
    expect(editBlocker(state(), w([paint]))).toBeNull();
    state().setInpaint({ preset: "move" });
    expect(editBlocker(state(), w([box]))).toMatch(/two boxes/);
    expect(editBlocker(state(), w([box, { ...box, x: 20 }]))).toBeNull();
    state().setInpaint({ preset: "remove" });
    expect(editBlocker(state(), w([box]))).toBeNull();
    expect(editBlocker(state(), w([paint]))).toMatch(/box/);
  });

  it("outpaint needs an uploaded image and some padding, but no prompt", () => {
    state().patch({ mode: "outpaint" });
    const o = (pads: object, status = "ready") => ({ ...noWs, outpaint: { src, pads: { l: 0, t: 0, r: 0, b: 0, ...pads }, upload: { status } } });
    expect(editBlocker(state(), noWs)).toMatch(/Choose an image/);
    expect(editBlocker(state(), o({ l: 10 }, "uploading"))).toMatch(/Uploading/);
    expect(editBlocker(state(), o({}))).toMatch(/padding/);
    expect(editBlocker(state(), o({ r: 64 }))).toBeNull();
  });
});

describe("request building", () => {
  it("multi-edit: workflow defaults produce no overrides, presets set the LoRA flags", () => {
    state().setPrompt("multiedit", "  edit me  ");
    const p = multiParams(state(), [slot(), slot({ id: "b", file: "f2.png", name: "b.jpg" })]);
    expect(p).toMatchObject({
      mode: "multiedit",
      prompt: "edit me",
      images: [
        { file: "f1.png", name: "a.png" },
        { file: "f2.png", name: "b.jpg" },
      ],
      prompt_enhancer: true,
      keep_original_resolution: false,
      pixel_drift_fix: true,
      manual_size: false,
      head_swap: false,
      body_swap: false,
    });
    for (const k of ["seed", "sampler", "loras", "base_megapixels", "ref_megapixels"]) expect(p).not.toHaveProperty(k);
    expect(p.size_hint).toEqual([1414, 707]); // 2:1 image scaled to 1 MP
    state().setMulti({ preset: "body" });
    expect(multiParams(state(), [slot(), slot({ id: "b" })])).toMatchObject({ head_swap: false, body_swap: true });
  });

  it("multi-edit: overrides, locked seed, per-reference megapixels and the manual size hint", () => {
    state().setMulti({ baseMp: 2, refMp: { 1: 0.5 }, manualSize: true, manualW: 1024, manualH: 768, keepOriginal: false });
    state().setSeed("multiedit", true, 99);
    state().setSampler("multiedit", { steps: 8 });
    state().setLoras("multiedit", [{ name: "qwen/x.safetensors", strength: 0.8, on: true, target: "both" }]);
    state().setPrompt("multiedit", "x");
    const p = multiParams(state(), [slot()]);
    expect(p).toMatchObject({ seed: 99, sampler: { steps: 8 }, base_megapixels: 2, ref_megapixels: [null, 0.5], manual_size: true, size_hint: [1024, 768] });
    expect(p.loras).toEqual([{ name: "qwen/x.safetensors", strength: 0.8, on: true }]);
  });

  it("multi-edit: base megapixels are not sent when the original resolution is kept", () => {
    state().setMulti({ baseMp: 2, keepOriginal: true });
    state().setPrompt("multiedit", "x");
    const p = multiParams(state(), [slot()]);
    expect(p).not.toHaveProperty("base_megapixels");
    expect(p.size_hint).toEqual([2000, 1000]);
  });

  it("inpaint: crop overrides, preset flags and size hint", () => {
    state().setPrompt("inpaint", "a hat");
    state().setInpaint({ invert: true, crop: { mask_grow: 20 }, preset: "remove", seam: "blend in" });
    expect(inpaintParams(state(), "m.png", src)).toMatchObject({
      mode: "inpaint",
      prompt: "a hat",
      image: "m.png",
      invert_mask: true,
      mask_grow: 20,
      remover: true,
      mover: false,
      seam: "blend in",
      size_hint: [800, 600],
    });
  });

  it("outpaint: pads, fill and the default prompt when the field is empty", () => {
    state().setOutpaint({ fillMode: "mirror", feather: 64 });
    const p = outpaintParams(state(), src, "o.png", { l: 10, t: 20, r: 30, b: 40 }, "DEFAULT");
    expect(p).toMatchObject({ mode: "outpaint", prompt: "DEFAULT", image: "o.png", pad_left: 10, pad_top: 20, pad_right: 30, pad_bottom: 40, fill_mode: "mirror", feather: 64, size_hint: [840, 660] });
    expect(p).not.toHaveProperty("target_megapixels");
  });
});

describe("presets", () => {
  it("carry the exact texts from the workflow notes", () => {
    expect(PRESETS.head.prompt.startsWith("head_swap: start with <image1>")).toBe(true);
    expect(PRESETS.body.prompt.startsWith("body_swap: start with <image1>")).toBe(true);
    expect(PRESETS.remove.prompt).toBe("Remove the red highlighted object from the scene");
    expect(PRESETS.move.prompt).toBe("Move the object highlighted in the red box to the location indicated by the other red box in the scene.");
  });
});

describe("reuse", () => {
  const def = {
    multiedit: { sampler: { steps: 6, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 } },
    inpaint: { sampler: { steps: 6 }, crop: { mask_grow: 8 }, seam: "classic" },
    outpaint: { sampler: {}, feather: 32, seam: "blend in" },
  } as unknown as EditDefaults;
  const job = (params: Record<string, unknown>, seeds = { main: 7 }): Job => ({ id: "j", mode: String(params.mode), params, seeds }) as unknown as Job;

  it("restores a multi-edit job's settings and locks its seed", () => {
    reuseEditSettings(
      job({ mode: "multiedit", prompt: "p", prompt_enhancer: false, keep_original_resolution: true, pixel_drift_fix: false, head_swap: true, ref_megapixels: [null, 0.5], sampler: { steps: 6, cfg: 2 } }),
      def,
    );
    const s = state();
    expect(s.mode).toBe("multiedit");
    expect(s.prompts.multiedit).toBe("p");
    expect(s.enhancer.multiedit).toBe(false);
    expect(s.multi).toMatchObject({ keepOriginal: true, pixelDrift: false, preset: "head", refMp: { 1: 0.5 } });
    expect(s.sampler.multiedit).toEqual({ cfg: 2 }); // steps equal the default, so no override
    expect([s.lockSeed.multiedit, s.seeds.multiedit]).toEqual([true, 7]);
  });

  it("restores inpaint crop overrides only where they differ from the default", () => {
    reuseEditSettings(job({ mode: "inpaint", prompt: "q", mask_grow: 8, context_factor: 2, remover: true, seam: "classic" }), def);
    expect(state().inpaint).toMatchObject({ crop: { context_factor: 2 }, preset: "remove", seam: undefined });
  });

  it("restores outpaint fill settings", () => {
    reuseEditSettings(job({ mode: "outpaint", prompt: "", fill_mode: "mirror", fill_color: "#112233", feather: 64, seam: "blend in" }), def);
    expect(state().outpaint).toMatchObject({ fillMode: "mirror", fillColor: "#112233", feather: 64, seam: undefined });
  });
});

describe("Manual size and Pixel Drift Fix", () => {
  it("turning Manual size on switches Pixel Drift Fix off, turning it off restores it", () => {
    expect(state().multi.pixelDrift).toBe(true);
    state().setManualSize(true);
    expect(state().multi).toMatchObject({ manualSize: true, pixelDrift: false, driftAuto: true });
    expect(multiParams(state(), [slot()])).toMatchObject({ manual_size: true, pixel_drift_fix: false });
    state().setManualSize(false);
    expect(state().multi).toMatchObject({ manualSize: false, pixelDrift: true, driftAuto: false });
  });

  it("the user can turn it back on while Manual size stays on, and that choice sticks", () => {
    state().setManualSize(true);
    state().setPixelDrift(true);
    expect(state().multi).toMatchObject({ manualSize: true, pixelDrift: true, driftAuto: false });
    state().setManualSize(false);
    expect(state().multi.pixelDrift).toBe(true);
  });

  it("does not switch it on when the user had already turned it off", () => {
    state().setPixelDrift(false);
    state().setManualSize(true);
    expect(state().multi.driftAuto).toBe(false);
    state().setManualSize(false);
    expect(state().multi.pixelDrift).toBe(false);
  });

  it("Reuse settings does not carry a stale automatic switch-off", () => {
    state().setManualSize(true);
    reuseEditSettings({ id: "j", mode: "multiedit", params: { mode: "multiedit", prompt: "p", pixel_drift_fix: true }, seeds: { main: 1 } } as never, null);
    expect(state().multi).toMatchObject({ pixelDrift: true, driftAuto: false });
  });
});

describe("Edit model choice", () => {
  it("sends unet_name only when a model is chosen, in every mode", () => {
    expect(multiParams(state(), [slot()])).not.toHaveProperty("unet_name");
    state().patch({ model: "Qwen-Other.safetensors" });
    expect(multiParams(state(), [slot()]).unet_name).toBe("Qwen-Other.safetensors");
    expect(inpaintParams(state(), "m.png", src).unet_name).toBe("Qwen-Other.safetensors");
    expect(outpaintParams(state(), src, "o.png", { l: 8, t: 0, r: 0, b: 0 }, "p").unet_name).toBe("Qwen-Other.safetensors");
  });

  it("reuse restores the job's model, or the default when it had none", () => {
    reuseEditSettings({ id: "j", mode: "inpaint", params: { mode: "inpaint", prompt: "p", unet_name: "Qwen-Other.safetensors" }, seeds: { main: 1 } } as never, null);
    expect(state().model).toBe("Qwen-Other.safetensors");
    reuseEditSettings({ id: "j", mode: "inpaint", params: { mode: "inpaint", prompt: "p" }, seeds: { main: 1 } } as never, null);
    expect(state().model).toBeUndefined();
  });
});

describe("per-model sampler preset", () => {
  it("saves the sampler settings of every mode for the chosen model and restores them on choosing it again", () => {
    state().setModel("Qwen-Other.safetensors");
    state().setSampler("inpaint", { steps: 30, cfg: 4 });
    state().setSampler("multiedit", { steps: 20 });
    state().saveModelPreset();
    state().setSampler("inpaint", { steps: 6 });
    state().setModel(undefined);
    expect(state().sampler.inpaint).toEqual({ steps: 6 });
    state().setModel("Qwen-Other.safetensors");
    expect(state().sampler.inpaint).toEqual({ steps: 30, cfg: 4 });
    expect(state().sampler.multiedit).toEqual({ steps: 20 });
  });

  it("choosing a model without a preset keeps the current sampler, and saving needs a chosen model", () => {
    state().saveModelPreset();
    expect(state().modelPresets).toEqual({});
    state().setSampler("inpaint", { steps: 9 });
    state().setModel("Qwen-New.safetensors");
    expect(state().sampler.inpaint).toEqual({ steps: 9 });
  });
});

describe("Flux2 Klein model", () => {
  const KLEIN = "flux-2-klein-9b-Q8_0.gguf";
  const slots = (n: number) => Array.from({ length: n }, (_, i) => slot({ id: String(i) }));

  it("only Multi-edit works, with up to 3 images", () => {
    state().patch({ model: KLEIN });
    state().setPrompt("multiedit", "x");
    expect(editBlocker(state(), { ...noWs, slots: slots(3) })).toBeNull();
    expect(editBlocker(state(), { ...noWs, slots: slots(4) })).toMatch(/up to 3 images/);
    state().patch({ mode: "inpaint" });
    expect(editBlocker(state(), noWs)).toMatch(/only do Multi-edit/);
    state().patch({ mode: "outpaint" });
    expect(editBlocker(state(), noWs)).toMatch(/only do Multi-edit/);
  });

  it("a leftover head/body preset does not block or reach the server", () => {
    state().patch({ model: KLEIN });
    state().setPrompt("multiedit", "x");
    state().setMulti({ preset: "head", keepOriginal: true });
    expect(editBlocker(state(), { ...noWs, slots: [slot()] })).toBeNull();
    expect(multiParams(state(), [slot()])).toMatchObject({ head_swap: false, body_swap: false, keep_original_resolution: false });
  });

  it("sends only steps, CFG and sampler name", () => {
    state().patch({ model: KLEIN });
    state().setSampler("multiedit", { steps: 6, cfg: 1.5, sampler_name: "euler", scheduler: "karras", denoise: 0.5 });
    expect(multiParams(state(), [slot()]).sampler).toEqual({ steps: 6, cfg: 1.5, sampler_name: "euler" });
  });

  it("switching between Qwen and Klein drops the sampler overrides made for the other family", () => {
    state().setSampler("multiedit", { steps: 12 });
    state().setModel(KLEIN);
    expect(state().sampler.multiedit).toEqual({});
    state().setSampler("multiedit", { steps: 8 });
    state().setModel("Qwen-Other.safetensors");
    expect(state().sampler.multiedit).toEqual({});
    state().setSampler("multiedit", { steps: 9 });
    state().setModel(undefined);
    expect(state().sampler.multiedit).toEqual({ steps: 9 });
  });

  it("reuse compares the sampler against the Klein defaults", () => {
    const def = { klein: { sampler: { steps: 4, cfg: 1, sampler_name: "euler" } }, multiedit: { sampler: { steps: 6, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 } } } as unknown as EditDefaults;
    reuseEditSettings({ id: "j", mode: "multiedit", params: { mode: "multiedit", prompt: "p", unet_name: KLEIN, sampler: { steps: 4, cfg: 2 } }, seeds: { main: 1 } } as unknown as Job, def);
    expect(state().model).toBe(KLEIN);
    expect(state().sampler.multiedit).toEqual({ cfg: 2 });
  });
});
