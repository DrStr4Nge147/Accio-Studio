import { describe, expect, it } from "vitest";
import { boxesOf, hasMaskOps, type Op } from "./maskOps";
import { padsForRatio } from "./pads";

const stroke = (erase: boolean): Op => ({ t: "stroke", erase, size: 10, pts: [1, 1] });

describe("mask ops", () => {
  it("counts boxes and paint, but not an eraser-only history", () => {
    expect(hasMaskOps([])).toBe(false);
    expect(hasMaskOps([stroke(true)])).toBe(false);
    expect(hasMaskOps([stroke(true), stroke(false)])).toBe(true);
    expect(hasMaskOps([{ t: "box", x: 0, y: 0, w: 5, h: 5 }])).toBe(true);
  });

  it("lists boxes in drawing order", () => {
    const ops: Op[] = [{ t: "box", x: 1, y: 2, w: 3, h: 4 }, stroke(false), { t: "box", x: 5, y: 6, w: 7, h: 8 }];
    expect(boxesOf(ops)).toEqual([
      { x: 1, y: 2, w: 3, h: 4 },
      { x: 5, y: 6, w: 7, h: 8 },
    ]);
  });
});

describe("padsForRatio", () => {
  it("widens a portrait image to 1:1 evenly left and right", () => {
    expect(padsForRatio(600, 800, 1, 1)).toEqual({ l: 100, r: 100, t: 0, b: 0 });
  });
  it("heightens a landscape image to 1:1 evenly top and bottom", () => {
    expect(padsForRatio(800, 600, 1, 1)).toEqual({ l: 0, r: 0, t: 100, b: 100 });
  });
  it("puts the odd pixel on the far side", () => {
    expect(padsForRatio(1001, 1000, 1, 1)).toEqual({ l: 0, r: 0, t: 0, b: 1 });
  });
  it("grows the canvas to exactly the ratio", () => {
    const p = padsForRatio(1000, 1000, 16, 9);
    expect(p.t + p.b).toBe(0); // a square is narrower than 16:9, so it widens
    expect(p.l + p.r).toBe(778);
    expect((1000 + p.l + p.r) / 1000).toBeCloseTo(16 / 9, 2);
  });
});
