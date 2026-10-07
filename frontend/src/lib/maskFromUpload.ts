/**
 * The uploaded Inpaint file stores the mask as transparency (alpha 0 where painted). For the running view we need the
 * opposite, a shape that is opaque where painted, to use as a CSS mask. Pure part, so it can be tested.
 */
export function maskFromUploadPixels(rgba: Uint8ClampedArray | Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const painted = 255 - rgba[i + 3]!;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
    rgba[i + 3] = painted;
  }
}

const cache = new Map<string, string>();

/** Fetch the uploaded mask file, flip it into a painted-area shape and return it as an object URL (cached per key). */
export async function maskShapeFromUpload(key: string, url: string, maxPixels = 1_000_000): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error("mask not available");
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const k = Math.min(1, Math.sqrt(maxPixels / (bmp.width * bmp.height)));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  maskFromUploadPixels(img.data);
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not build the mask preview");
  const out = URL.createObjectURL(blob);
  cache.set(key, out);
  return out;
}
