import { describe, expect, it } from "vitest";
import { paddedLayout } from "./paddedBefore";

describe("paddedLayout", () => {
  it("places the original at the padding offset on the padded canvas", () => {
    expect(paddedLayout(512, 384, { l: 128, t: 0, r: 128, b: 0 })).toEqual({ cw: 768, ch: 384, x: 128, y: 0, w: 512, h: 384 });
  });
  it("scales everything down together to stay under the pixel budget, keeping the shape", () => {
    const l = paddedLayout(4000, 3000, { l: 1000, t: 0, r: 1000, b: 0 }, 1_500_000);
    expect(l.cw * l.ch).toBeLessThanOrEqual(1_500_000 * 1.01);
    expect(l.cw / l.ch).toBeCloseTo(6000 / 3000, 2);
    expect(l.x / l.cw).toBeCloseTo(1000 / 6000, 2);
    expect(l.w / l.cw).toBeCloseTo(4000 / 6000, 2);
  });
});
