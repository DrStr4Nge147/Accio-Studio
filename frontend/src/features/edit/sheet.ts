/** Character sheet: the views a sheet can hold and the sizes the server renders them at (mirrors server/sheets.py). */

export type SheetDelivery = "separate" | "merged";

export interface SheetView {
  key: string;
  label: string;
}

export const FACE_VIEWS: SheetView[] = [
  { key: "front", label: "Front" },
  { key: "three_quarter_left", label: "3/4 left" },
  { key: "left_profile", label: "Left profile" },
  { key: "three_quarter_right", label: "3/4 right" },
  { key: "right_profile", label: "Right profile" },
  { key: "back", label: "Back of head" },
];

export const BODY_VIEWS: SheetView[] = [
  { key: "front", label: "Front" },
  { key: "three_quarter_left", label: "3/4 left" },
  { key: "left_side", label: "Left side" },
  { key: "back", label: "Back" },
  { key: "right_side", label: "Right side" },
  { key: "three_quarter_right", label: "3/4 right" },
];

export type Size = [number, number];
export type SizeMode = "auto" | "manual";
export interface GroupSizes {
  face: Size;
  body: Size;
}

export interface SheetState {
  delivery: SheetDelivery;
  faceViews: string[];
  bodyViews: string[];
  /** auto = the tuned size times `scale`; manual = the sizes typed in `manual` */
  sizeMode: SizeMode;
  scale: number;
  /** typed sizes per delivery: a view's size when separate, the whole sheet's size when merged */
  manual: Record<SheetDelivery, GroupSizes>;
}

/** The sizes the model is tuned for (1x): one view when separate, a whole drawn sheet when merged. */
export const BASE_SIZES: Record<SheetDelivery, GroupSizes> = {
  separate: { face: [1024, 1024], body: [768, 1344] },
  merged: { face: [1536, 1024], body: [1536, 768] },
};
export const SCALES = [1, 1.5, 2, 3, 4];
export const MIN_SIZE = 64;
export const MAX_SIZE = 8192;

export const initialSheet = (): SheetState => ({
  delivery: "separate",
  faceViews: ["front", "three_quarter_left", "left_profile", "three_quarter_right", "right_profile"],
  bodyViews: ["front", "three_quarter_left", "left_side", "back", "right_side", "three_quarter_right"],
  sizeMode: "auto",
  scale: 1,
  manual: structuredClone(BASE_SIZES),
});

const PAD = 24;

/** A size multiplied by `k`, each side rounded to a multiple of 8 (what the model needs) and kept in range. */
export const scaleSize = ([w, h]: Size, k: number): Size => {
  const side = (v: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round((v * k) / 8) * 8));
  return [side(w), side(h)];
};

/** The sizes this sheet will render at. */
export function sheetSizes(s: SheetState): GroupSizes {
  const base = BASE_SIZES[s.delivery];
  if (s.sizeMode === "manual") return s.manual[s.delivery];
  return { face: scaleSize(base.face, s.scale), body: scaleSize(base.body, s.scale) };
}

const validSide = (n: number) => Number.isInteger(n) && n % 8 === 0 && n >= MIN_SIZE && n <= MAX_SIZE;

/** A message when a typed size cannot be used (only manual sizes can be wrong), else null. */
export function sizeProblem(s: SheetState): string | null {
  if (s.sizeMode !== "manual") return null;
  const { face, body } = s.manual[s.delivery];
  const used = [...(s.faceViews.length ? face : []), ...(s.bodyViews.length ? body : [])];
  return used.every(validSide) ? null : `Sizes must be multiples of 8, from ${MIN_SIZE} to ${MAX_SIZE}.`;
}

/** How many renders the GPU does: one per view when separate, two sheets when merged. */
export function renderCount(s: SheetState): number {
  if (s.delivery === "merged") return (s.faceViews.length ? 1 : 0) + (s.bodyViews.length ? 1 : 0);
  return s.faceViews.length + s.bodyViews.length;
}

const columns = (n: number) => (n <= 3 ? n : n === 4 ? 2 : 3);

/** Size of one stitched sheet of `n` views, as the server lays it out. */
function stitchedSize(n: number, [cw, ch]: Size): Size {
  const cols = columns(n);
  const rows = Math.ceil(n / cols);
  const cap = Math.max(36, Math.round(cw * 0.04));
  return [PAD + cols * (cw + PAD), PAD + rows * (ch + cap + PAD)];
}

/** Display-only size of the sheet's first picture (the faces sheet, or the body sheet when there are no faces). */
export function sheetSizeHint(s: SheetState): Size {
  const { face, body } = sheetSizes(s);
  if (s.delivery === "merged") return s.faceViews.length ? face : body;
  return s.faceViews.length ? stitchedSize(s.faceViews.length, face) : stitchedSize(s.bodyViews.length, body);
}

export const toggleView = (list: string[], key: string, order: SheetView[]): string[] =>
  order.map((v) => v.key).filter((k) => (k === key ? !list.includes(k) : list.includes(k)));
