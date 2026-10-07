import type { Rect } from "../../lib/inpaintExport";

/** What the user did on the Inpaint canvas, in order. Undo pops one; the canvases are redrawn from this list. */
export type Op =
  | { t: "stroke"; erase: boolean; size: number; pts: number[] } // pts = x0, y0, x1, y1... in image pixels
  | ({ t: "box" } & Rect);

type Ctx = CanvasRenderingContext2D;

export const MASK_COLOR = "#E8B04A";
export const BOX_COLOR = "#FF2A2A";

/** Draw one segment (or a dot when a == b) of a brush stroke. */
export function strokeSegment(ctx: Ctx, size: number, erase: boolean, ax: number, ay: number, bx: number, by: number, color: string) {
  ctx.save();
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (ax === bx && ay === by) {
    ctx.beginPath();
    ctx.arc(ax, ay, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.restore();
}

function paintOp(ctx: Ctx, op: Op, color: string) {
  if (op.t === "box") {
    ctx.fillStyle = color;
    ctx.fillRect(op.x, op.y, op.w, op.h);
    return;
  }
  const p = op.pts;
  if (p.length < 4) return strokeSegment(ctx, op.size, op.erase, p[0]!, p[1]!, p[0]!, p[1]!, color);
  ctx.save();
  ctx.globalCompositeOperation = op.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = color;
  ctx.lineWidth = op.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  ctx.stroke();
  ctx.restore();
}

/** Repaint the mask layer (brush strokes and the filled boxes) from the op list. */
export function renderMask(ctx: Ctx, ops: Op[], w: number, h: number, color = MASK_COLOR) {
  ctx.clearRect(0, 0, w, h);
  for (const op of ops) paintOp(ctx, op, color);
}

/** Repaint the red box outlines (display only; the export burns them into the RGB). */
export function renderLines(ctx: Ctx, boxes: Rect[], w: number, h: number, stroke: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = BOX_COLOR;
  ctx.lineWidth = stroke;
  for (const b of boxes) ctx.strokeRect(b.x + stroke / 2, b.y + stroke / 2, b.w - stroke, b.h - stroke);
}

export const boxesOf = (ops: Op[]): Rect[] =>
  ops.filter((o): o is Extract<Op, { t: "box" }> => o.t === "box").map(({ x, y, w, h }) => ({ x, y, w, h }));

/** Cheap check for "is there anything to inpaint" (an eraser-only history counts as empty). */
export const hasMaskOps = (ops: Op[]) => ops.some((o) => o.t === "box" || !o.erase);

/** One byte per pixel, 255 where the user painted (alpha of the mask layer). */
export function maskBytes(ops: Op[], w: number, h: number): Uint8Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  renderMask(ctx, ops, w, h, "#fff");
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3]!;
  return out;
}

export const isEmptyMask = (mask: Uint8Array) => !mask.some((v) => v > 0);

/**
 * The painted shape as a small transparent PNG (object URL), for the "running" view: a CSS mask that lets a light sweep
 * show only inside the area being regenerated, whatever its shape.
 */
export async function maskPreviewUrl(ops: Op[], w: number, h: number, maxPixels = 1_000_000): Promise<string> {
  const k = Math.min(1, Math.sqrt(maxPixels / (w * h)));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext("2d")!;
  ctx.scale(k, k);
  renderMask(ctx, ops, w, h, "#fff");
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not build the mask preview");
  return URL.createObjectURL(blob);
}
