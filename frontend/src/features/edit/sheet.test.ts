import { beforeEach, describe, expect, it } from "vitest";
import { editBlocker, sheetParams } from "./params";
import { BODY_VIEWS, FACE_VIEWS, initialSheet, renderCount, scaleSize, sheetSizeHint, sheetSizes, sizeProblem, toggleView } from "./sheet";
import { useEdit } from "./store";
import type { Source } from "./workspace";

const state = () => useEdit.getState();
const src = { blob: new Blob(), url: "blob:x", w: 800, h: 1200, name: "me.jpg" } satisfies Source;
const none = { slots: [], inpaint: { src: null, ops: [] }, outpaint: { src: null, pads: { l: 0, t: 0, r: 0, b: 0 }, upload: { status: "idle" } } };
const ready = { ...none, sheet: { src, upload: { status: "ready" } } };

beforeEach(() => {
  state().reset("charsheet");
  state().patch({ mode: "charsheet", model: undefined, grain: { on: false, strength: 0.04 } });
});

describe("character sheet views", () => {
  it("counts one render per view, or two when merged", () => {
    expect(renderCount(initialSheet())).toBe(11);
    expect(renderCount({ ...initialSheet(), delivery: "merged" })).toBe(2);
    expect(renderCount({ ...initialSheet(), delivery: "merged", faceViews: [], bodyViews: ["front"] })).toBe(1);
    expect(renderCount({ ...initialSheet(), faceViews: [], bodyViews: [] })).toBe(0);
  });

  it("toggles a view and keeps the display order", () => {
    expect(toggleView(["front", "back"], "left_profile", FACE_VIEWS)).toEqual(["front", "left_profile", "back"]);
    expect(toggleView(["front", "back"], "back", BODY_VIEWS)).toEqual(["front"]);
  });

  it("sizes the placeholder like the stitched faces sheet (5 views: 3 columns, 2 rows)", () => {
    expect(sheetSizeHint(initialSheet())).toEqual([24 + 3 * (1024 + 24), 24 + 2 * (1024 + 41 + 24)]);
    expect(sheetSizeHint({ ...initialSheet(), delivery: "merged" })).toEqual([1536, 1024]);
    expect(sheetSizeHint({ ...initialSheet(), faceViews: [], bodyViews: ["front", "back"] })).toEqual([24 + 2 * (768 + 24), 24 + (1344 + 36 + 24)]);
  });
});

describe("character sheet resolution", () => {
  it("scales the tuned size and keeps every side a multiple of 8", () => {
    expect(scaleSize([1024, 1024], 2)).toEqual([2048, 2048]);
    expect(scaleSize([768, 1344], 1.5)).toEqual([1152, 2016]);
    expect(scaleSize([1536, 768], 1.5)).toEqual([2304, 1152]);
    expect(scaleSize([1024, 1024], 100)).toEqual([8192, 8192]);
  });

  it("auto follows the delivery and scale; manual uses the typed sizes", () => {
    const s = initialSheet();
    expect(sheetSizes(s)).toEqual({ face: [1024, 1024], body: [768, 1344] });
    expect(sheetSizes({ ...s, scale: 2 })).toEqual({ face: [2048, 2048], body: [1536, 2688] });
    expect(sheetSizes({ ...s, delivery: "merged", scale: 2 })).toEqual({ face: [3072, 2048], body: [3072, 1536] });
    expect(sheetSizes({ ...s, sizeMode: "manual", manual: { ...s.manual, separate: { face: [640, 640], body: [512, 1024] } } })).toEqual({ face: [640, 640], body: [512, 1024] });
  });

  it("only complains about typed sizes that are used and invalid", () => {
    const s = initialSheet();
    const bad = { ...s, sizeMode: "manual" as const, manual: { ...s.manual, separate: { face: [1020, 1024] as [number, number], body: [768, 1344] as [number, number] } } };
    expect(sizeProblem(s)).toBeNull();
    expect(sizeProblem(bad)).toMatch(/multiples of 8/);
    expect(sizeProblem({ ...bad, faceViews: [] })).toBeNull(); // the faces are not rendered, so their size does not matter
  });

  it("sends the sizes and uses them for the placeholder", () => {
    state().setSheet({ scale: 2 });
    const p = sheetParams(state(), { file: "a.png", name: "x" });
    expect(p).toMatchObject({ face_size: [2048, 2048], body_size: [1536, 2688] });
    expect(p.size_hint).toEqual([24 + 3 * (2048 + 24), 24 + 2 * (2048 + 82 + 24)]);
  });
});

describe("character sheet request", () => {
  it("is blocked until a photo is uploaded and a view is chosen", () => {
    expect(editBlocker(state(), none)).toBe("Choose a photo of the character first.");
    expect(editBlocker(state(), { ...ready, sheet: { src, upload: { status: "uploading" } } })).toBe("Uploading the photo…");
    state().setSheet({ faceViews: [], bodyViews: [] });
    expect(editBlocker(state(), ready)).toBe("Choose at least one view.");
    state().setSheet(initialSheet());
    expect(editBlocker(state(), ready)).toBeNull(); // notes are optional
  });

  it("sends the photo, views and settings; notes only when written", () => {
    const p = sheetParams(state(), { file: "abc.png", name: "me.jpg" });
    expect(p).toMatchObject({ mode: "charsheet", image: { file: "abc.png", name: "me.jpg" }, delivery: "separate" });
    expect(p.face_views).toHaveLength(5);
    expect(p.body_views).toHaveLength(6);
    expect(p).not.toHaveProperty("notes");
    state().setPrompt("charsheet", "  red scarf ");
    state().setSeed("charsheet", true, 42);
    state().setSheet({ delivery: "merged" });
    expect(sheetParams(state(), { file: "abc.png", name: "me.jpg" })).toMatchObject({ notes: "red scarf", seed: 42, delivery: "merged", size_hint: [1536, 1024] });
  });

  it("keeps a Klein model for sheets (they are Multi-edit jobs)", () => {
    state().patch({ model: "flux2-klein-9b.gguf" });
    expect(sheetParams(state(), { file: "a.png", name: "x" }).unet_name).toBe("flux2-klein-9b.gguf");
  });
});
