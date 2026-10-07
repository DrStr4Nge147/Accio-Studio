/**
 * Minimal lossless RGBA PNG encoder. Canvas `toBlob` cannot be used for the Inpaint mask: canvases store premultiplied
 * alpha, so every pixel painted as "mask" (alpha 0) would lose its RGB. ComfyUI's LoadImage keeps the RGB and derives
 * the mask from alpha, so we write the PNG ourselves and the original colours stay byte for byte (APP_SPEC 5.3).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const buf of parts) for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const name = new TextEncoder().encode(type);
  out.set(name, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([name, data]));
  return out;
}

/** zlib stream (what PNG's IDAT needs) from the browser's built-in compressor. */
async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Rows with the "Sub" filter (type 1): much smaller than unfiltered for photos, still exact. */
export function filterRows(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const stride = w * 4;
  const out = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const src = y * stride;
    const dst = y * (stride + 1);
    out[dst] = 1;
    for (let i = 0; i < stride; i++) out[dst + 1 + i] = (rgba[src + i]! - (i >= 4 ? rgba[src + i - 4]! : 0)) & 0xff;
  }
  return out;
}

export async function encodeRgbaPng(w: number, h: number, rgba: Uint8Array | Uint8ClampedArray): Promise<Uint8Array> {
  if (rgba.length !== w * h * 4) throw new Error("pixel buffer does not match the image size");
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bit, colour type 6 (RGBA), deflate, adaptive filter, no interlace
  const idat = await zlib(filterRows(rgba, w, h));
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
