import { describe, expect, it } from "vitest";
import { applyMaskAlpha, boxStroke, burnBoxes } from "./inpaintExport";
import { crc32, encodeRgbaPng } from "./png";

/** Read a PNG back with the browser-standard DecompressionStream: chunks, CRCs, then undo the Sub filter. */
async function decode(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  const idat: Uint8Array[] = [];
  const names: string[] = [];
  while (at < png.length) {
    const len = dv.getUint32(at);
    const name = String.fromCharCode(...png.slice(at + 4, at + 8));
    const data = png.slice(at + 8, at + 8 + len);
    expect(dv.getUint32(at + 8 + len)).toBe(crc32([png.slice(at + 4, at + 8), data]));
    names.push(name);
    if (name === "IHDR") {
      w = new DataView(data.buffer, data.byteOffset).getUint32(0);
      h = new DataView(data.buffer, data.byteOffset).getUint32(4);
      type = data[9]!;
    }
    if (name === "IDAT") idat.push(data);
    at += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = new Uint8Array(await new Response(new Blob([joined as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w * 4 + 1)]).toBe(1); // Sub filter
    for (let i = 0; i < w * 4; i++) out[y * w * 4 + i] = (raw[y * (w * 4 + 1) + 1 + i]! + (i >= 4 ? out[y * w * 4 + i - 4]! : 0)) & 0xff;
  }
  return { w, h, type, names, pixels: out };
}

describe("encodeRgbaPng", () => {
  it("round-trips pixels exactly, including RGB under alpha 0 (the reason it exists)", async () => {
    const w = 5;
    const h = 3;
    const px = new Uint8Array(w * h * 4).map((_, i) => (i * 37 + 11) & 0xff);
    for (let i = 0; i < w * h; i++) px[i * 4 + 3] = i % 4 === 0 ? 0 : 255;
    const png = await encodeRgbaPng(w, h, px);
    const back = await decode(png);
    expect([back.w, back.h, back.type]).toEqual([w, h, 6]);
    expect(back.names).toEqual(["IHDR", "IDAT", "IEND"]);
    expect([...back.pixels]).toEqual([...px]);
  });

  it("is recognised by the server's RGBA check (colour type byte at offset 25)", async () => {
    const png = await encodeRgbaPng(2, 2, new Uint8Array(16));
    expect(png[25]).toBe(6);
  });

  it("rejects a buffer that does not match the size", async () => {
    await expect(encodeRgbaPng(2, 2, new Uint8Array(10))).rejects.toThrow();
  });
});

describe("mask and box burning", () => {
  it("sets alpha to 255 - mask and leaves RGB alone", () => {
    const px = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    applyMaskAlpha(px, new Uint8Array([255, 0]));
    expect([...px]).toEqual([10, 20, 30, 0, 40, 50, 60, 255]);
  });

  it("burns pure red outlines inside the box and leaves the inside and the outside untouched", () => {
    const w = 20;
    const h = 20;
    const px = new Uint8Array(w * h * 4).fill(100);
    burnBoxes(px, w, h, [{ x: 4, y: 4, w: 10, h: 10 }], 2);
    const at = (x: number, y: number) => [...px.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
    expect(at(4, 4)).toEqual([255, 0, 0]); // corner
    expect(at(13, 8)).toEqual([255, 0, 0]); // right edge, 2 px thick
    expect(at(12, 8)).toEqual([255, 0, 0]);
    expect(at(8, 8)).toEqual([100, 100, 100]); // inside
    expect(at(3, 8)).toEqual([100, 100, 100]); // outside
    expect(at(14, 8)).toEqual([100, 100, 100]);
    expect(px[(4 * w + 4) * 4 + 3]).toBe(100); // alpha untouched
  });

  it("never writes outside the image", () => {
    const px = new Uint8Array(4 * 4 * 4);
    expect(() => burnBoxes(px, 4, 4, [{ x: -5, y: -5, w: 30, h: 30 }], 3)).not.toThrow();
  });

  it("scales the outline with the image", () => {
    expect(boxStroke(512, 512)).toBe(3);
    expect(boxStroke(4000, 3000)).toBe(18);
  });
});
