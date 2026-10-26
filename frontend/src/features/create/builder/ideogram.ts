/** One box on the layout canvas. x, y, w, h are fractions (0 to 1) of the image, as in the ComfyUI Ideogram 4 prompt builder. */
export interface Region {
  id: string;
  type: "obj" | "text";
  /** the words to render, for a text region */
  text: string;
  desc: string;
  /** "#rrggbb", at most 5 are used */
  palette: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export type StyleKind = "none" | "photo" | "art_style";

/** The scene-wide fields around the boxes. */
export interface Scene {
  overview: string;
  background: string;
  style: StyleKind;
  /** the photo or art style description, depending on `style` */
  styleText: string;
  aesthetics: string;
  lighting: string;
  medium: string;
  palette: string[];
}

export const EMPTY_SCENE: Scene = { overview: "", background: "", style: "photo", styleText: "", aesthetics: "", lighting: "", medium: "", palette: [] };

export const MAX_ELEMENT_COLORS = 5;

const grid = (v: number) => Math.max(0, Math.min(1000, Math.round(v * 1000)));
const colors = (list: string[]) => list.filter(Boolean).map((c) => c.toUpperCase());

/** [ymin, xmin, ymax, xmax] on Ideogram's 0 to 1000 grid. */
export function bboxOf(r: Pick<Region, "x" | "y" | "w" | "h">): [number, number, number, number] {
  const [ymin, ymax] = [grid(r.y), grid(r.y + r.h)].sort((a, b) => a - b) as [number, number];
  const [xmin, xmax] = [grid(r.x), grid(r.x + r.w)].sort((a, b) => a - b) as [number, number];
  return [ymin, xmin, ymax, xmax];
}

/** The Ideogram 4 JSON caption (compact, key order as the model's verifier expects), which the MOSS workflow reads its boxes from. */
export function buildCaption(scene: Scene, regions: Region[]): string {
  const caption: Record<string, unknown> = {};
  if (scene.overview.trim()) caption.high_level_description = scene.overview;
  if (scene.style !== "none") {
    const palette = colors(scene.palette);
    const style: Record<string, unknown> = { aesthetics: scene.aesthetics, lighting: scene.lighting };
    if (scene.style === "photo") Object.assign(style, { photo: scene.styleText, medium: scene.medium });
    else Object.assign(style, { medium: scene.medium, art_style: scene.styleText });
    if (palette.length) style.color_palette = palette;
    caption.style_description = style;
  }
  const elements = regions.map((r) => {
    const el: Record<string, unknown> = { type: r.type, bbox: bboxOf(r) };
    if (r.type === "text") el.text = r.text;
    el.desc = r.desc;
    const palette = colors(r.palette).slice(0, MAX_ELEMENT_COLORS);
    if (palette.length) el.color_palette = palette;
    return el;
  });
  caption.compositional_deconstruction = { background: scene.background, elements };
  return JSON.stringify(caption);
}

const SWATCHES = ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#6366f1", "#d946ef", "#84cc16", "#f97316"];

/** A box's outline color: its first palette color, else one from a fixed cycle by position. */
export const regionColor = (r: Pick<Region, "palette">, i: number) => r.palette[0] ?? SWATCHES[i % SWATCHES.length]!;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The inverse of buildCaption: the scene and boxes in a JSON caption prompt, or null when the text is not one. */
export function parseCaption(text: string): { scene: Scene; regions: Region[] } | null {
  if (!text.trimStart().startsWith("{")) return null;
  let caption: Record<string, unknown>;
  try {
    caption = rec(JSON.parse(text));
  } catch {
    return null;
  }
  const body = rec(caption.compositional_deconstruction);
  if (!Array.isArray(body.elements)) return null;
  const sd = rec(caption.style_description);
  const style: StyleKind = !caption.style_description ? "none" : "art_style" in sd ? "art_style" : "photo";
  const scene: Scene = {
    overview: str(caption.high_level_description),
    background: str(body.background),
    style,
    styleText: str(style === "art_style" ? sd.art_style : sd.photo),
    aesthetics: str(sd.aesthetics),
    lighting: str(sd.lighting),
    medium: str(sd.medium),
    palette: strs(sd.color_palette),
  };
  const regions = body.elements.map((raw, i): Region => {
    const el = rec(raw);
    const [ymin = 0, xmin = 0, ymax = 1000, xmax = 1000] = Array.isArray(el.bbox) ? (el.bbox as number[]) : [];
    return {
      id: `p${i}`,
      type: el.type === "text" ? "text" : "obj",
      text: str(el.text),
      desc: str(el.desc),
      palette: strs(el.color_palette),
      x: xmin / 1000,
      y: ymin / 1000,
      w: (xmax - xmin) / 1000,
      h: (ymax - ymin) / 1000,
    };
  });
  return { scene, regions };
}

/** True when there is nothing worth applying: no box has a description or text, and no background is written. */
export const isEmptyCaption = (scene: Scene, regions: Region[]) =>
  !scene.background.trim() && !scene.overview.trim() && !regions.some((r) => r.desc.trim() || r.text.trim());
