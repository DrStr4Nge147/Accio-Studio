import { describe, expect, it } from "vitest";
import { bboxOf, buildCaption, EMPTY_SCENE, isEmptyCaption, parseCaption, type Region } from "./ideogram";

const region = (p: Partial<Region>): Region => ({ id: "a", type: "obj", text: "", desc: "", palette: [], x: 0, y: 0, w: 1, h: 1, ...p });

describe("bboxOf", () => {
  it("is [ymin, xmin, ymax, xmax] on a 0 to 1000 grid", () => {
    expect(bboxOf({ x: 0.3, y: 0.12, w: 0.4, h: 0.8 })).toEqual([120, 300, 920, 700]);
  });

  it("orders a box dragged backwards and clamps it to the image", () => {
    expect(bboxOf({ x: 0.5, y: 0.5, w: -0.25, h: 0.9 })).toEqual([500, 250, 1000, 500]);
  });
});

describe("buildCaption", () => {
  it("matches the ComfyUI node: key order, compact, uppercase colors, palette capped at 5", () => {
    const scene = { ...EMPTY_SCENE, overview: "A portrait", background: "A lounge", styleText: "85mm", aesthetics: "elegant", lighting: "soft", medium: "photograph", palette: ["#f7e6df"] };
    const regions = [region({ desc: "A woman", x: 0.3, y: 0.12, w: 0.4, h: 0.8, palette: ["#aa0000", "#bb0000", "#cc0000", "#dd0000", "#ee0000", "#ff0000"] })];
    expect(buildCaption(scene, regions)).toBe(
      '{"high_level_description":"A portrait","style_description":{"aesthetics":"elegant","lighting":"soft","photo":"85mm","medium":"photograph","color_palette":["#F7E6DF"]},' +
        '"compositional_deconstruction":{"background":"A lounge","elements":[{"type":"obj","bbox":[120,300,920,700],"desc":"A woman","color_palette":["#AA0000","#BB0000","#CC0000","#DD0000","#EE0000"]}]}}',
    );
  });

  it("puts art_style after medium, and drops the style block for none", () => {
    const art = JSON.parse(buildCaption({ ...EMPTY_SCENE, style: "art_style", styleText: "oil", medium: "canvas" }, []));
    expect(Object.keys(art.style_description)).toEqual(["aesthetics", "lighting", "medium", "art_style"]);
    expect(JSON.parse(buildCaption({ ...EMPTY_SCENE, style: "none" }, [])).style_description).toBeUndefined();
  });

  it("gives a text region its text before the description, and omits a blank overview", () => {
    const caption = JSON.parse(buildCaption(EMPTY_SCENE, [region({ type: "text", text: "OPEN", desc: "neon sign" })]));
    expect(caption.high_level_description).toBeUndefined();
    expect(Object.keys(caption.compositional_deconstruction.elements[0])).toEqual(["type", "bbox", "text", "desc"]);
  });
});

describe("parseCaption", () => {
  it("reads back what buildCaption wrote", () => {
    const scene = { ...EMPTY_SCENE, overview: "o", background: "b", style: "art_style" as const, styleText: "oil", aesthetics: "a", lighting: "l", medium: "m", palette: ["#AA0000"] };
    const regions = [region({ id: "p0", type: "text", text: "OPEN", desc: "sign", palette: ["#FF0000"], x: 0.1, y: 0.2, w: 0.3, h: 0.4 })];
    const back = parseCaption(buildCaption(scene, regions))!;
    expect(back.scene).toEqual(scene);
    expect(back.regions[0]).toMatchObject({ type: "text", text: "OPEN", desc: "sign", x: 0.1, y: 0.2 });
    expect(back.regions[0]!.w).toBeCloseTo(0.3);
    expect(back.regions[0]!.h).toBeCloseTo(0.4);
  });

  it("is null for a plain prompt or other JSON", () => {
    expect(parseCaption("a fox in the snow")).toBeNull();
    expect(parseCaption("{broken")).toBeNull();
    expect(parseCaption('{"a":1}')).toBeNull();
  });
});

describe("isEmptyCaption", () => {
  it("needs a background, overview, or a described box", () => {
    expect(isEmptyCaption(EMPTY_SCENE, [region({})])).toBe(true);
    expect(isEmptyCaption({ ...EMPTY_SCENE, background: "x" }, [])).toBe(false);
    expect(isEmptyCaption(EMPTY_SCENE, [region({ desc: "x" })])).toBe(false);
  });
});
