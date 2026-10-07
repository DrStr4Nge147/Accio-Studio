import { encodeRgbaPng } from "./png";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExportArgs {
  file: Blob;
  w: number;
  h: number;
  /** One byte per pixel, 255 = painted (to be regenerated). */
  mask: Uint8Array;
  /** Red boxes for the Remove / Move presets: burned into the RGB as outlines. */
  boxes: Rect[];
  /** Outline thickness in image pixels. */
  stroke: number;
}

/** Thickness of the burned-in red outline: about 0.6% of the shorter side, at least 3 px. */
export const boxStroke = (w: number, h: number) => Math.max(3, Math.round(Math.min(w, h) * 0.006));

/** Draw each box as a pure red (255, 0, 0) rectangle outline, inside the box edge. */
export function burnBoxes(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, boxes: Rect[], stroke: number): void {
  const put = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    rgba[i] = 255;
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
  };
  for (const b of boxes) {
    const x0 = Math.round(b.x);
    const y0 = Math.round(b.y);
    const x1 = Math.round(b.x + b.w) - 1;
    const y1 = Math.round(b.y + b.h) - 1;
    const t = Math.min(stroke, Math.floor((Math.min(x1 - x0, y1 - y0) + 1) / 2) || 1);
    for (let y = y0; y <= y1; y++) {
      const edgeRow = y - y0 < t || y1 - y < t;
      for (let x = x0; x <= x1; x++) if (edgeRow || x - x0 < t || x1 - x < t) put(x, y);
    }
  }
}

/** ComfyUI's LoadImage derives the mask as 1 - alpha, so painted pixels get alpha 0 and everything else 255. */
export function applyMaskAlpha(rgba: Uint8ClampedArray | Uint8Array, mask: Uint8Array): void {
  for (let p = 0; p < mask.length; p++) rgba[p * 4 + 3] = 255 - mask[p]!;
}

function canvas2d(w: number, h: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    return c.getContext("2d", { willReadFrequently: true })!;
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d", { willReadFrequently: true })!;
}

/** Decode the source (upright, no colour conversion), keep its RGB, burn boxes, set alpha from the mask, encode PNG. */
export async function buildInpaintPng(a: ExportArgs): Promise<Uint8Array> {
  const bmp = await createImageBitmap(a.file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    if (bmp.width !== a.w || bmp.height !== a.h) throw new Error("image size changed while decoding");
    const ctx = canvas2d(a.w, a.h);
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, a.w, a.h).data;
    if (a.boxes.length) burnBoxes(px, a.w, a.h, a.boxes, a.stroke);
    applyMaskAlpha(px, a.mask);
    return await encodeRgbaPng(a.w, a.h, px);
  } finally {
    bmp.close();
  }
}

/** Runs in a worker when possible (spec 6.1a); if that fails for any reason, on the main thread. */
export async function exportInpaintPng(a: ExportArgs): Promise<Blob> {
  let bytes: Uint8Array | null = null;
  if (typeof Worker !== "undefined") {
    try {
      const mask = a.mask.slice(); // transferred to the worker; the original stays valid for the fallback
      bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const worker = new Worker(new URL("./inpaintWorker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>) => {
          worker.terminate();
          if (e.data.ok) resolve(e.data.bytes);
          else reject(new Error(e.data.error));
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message || "worker failed"));
        };
        worker.postMessage({ ...a, mask }, [mask.buffer]);
      });
    } catch {
      bytes = null;
    }
  }
  bytes ??= await buildInpaintPng(a);
  return new Blob([bytes as BlobPart], { type: "image/png" });
}
