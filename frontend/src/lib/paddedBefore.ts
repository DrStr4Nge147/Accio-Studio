export interface Pads {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Where the original sits on the padded canvas, scaled down so the preview stays at most `maxPixels` big. */
export function paddedLayout(w: number, h: number, pads: Pads, maxPixels = 1_500_000) {
  const W = w + pads.l + pads.r;
  const H = h + pads.t + pads.b;
  const k = Math.min(1, Math.sqrt(maxPixels / (W * H)));
  return { cw: Math.max(1, Math.round(W * k)), ch: Math.max(1, Math.round(H * k)), x: pads.l * k, y: pads.t * k, w: w * k, h: h * k };
}

const cache = new Map<string, string>();

/**
 * The "before" picture of an Outpaint job: the original on the padded canvas (the new area flat colour), so it lines up with
 * the result in the compare view. Built in the browser from the backend's copy of the original; cached per key.
 */
export async function paddedBefore(key: string, url: string, pads: Pads, fill: string): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  const img = new Image();
  img.src = url;
  await img.decode();
  const l = paddedLayout(img.naturalWidth, img.naturalHeight, pads);
  const c = document.createElement("canvas");
  c.width = l.cw;
  c.height = l.ch;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, l.cw, l.ch);
  ctx.drawImage(img, l.x, l.y, l.w, l.h);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not build the preview");
  const out = URL.createObjectURL(blob);
  cache.set(key, out);
  return out;
}
