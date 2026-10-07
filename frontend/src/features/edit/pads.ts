import type { Pads } from "./workspace";

/** Padding that grows the image to the given aspect ratio, split evenly on both sides of the short axis. */
export function padsForRatio(w: number, h: number, rw: number, rh: number): Pads {
  const target = rw / rh;
  if (w / h < target) {
    const extra = Math.round(h * target) - w;
    return { l: Math.floor(extra / 2), r: Math.ceil(extra / 2), t: 0, b: 0 };
  }
  const extra = Math.round(w / target) - h;
  return { l: 0, r: 0, t: Math.floor(extra / 2), b: Math.ceil(extra / 2) };
}

export const MAX_PAD = 16384;
export const clampPad = (n: number) => Math.min(MAX_PAD, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
