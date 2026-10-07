import { describe, expect, it } from "vitest";
import { gridLayout, itemPosition, nearEnd, visibleRange } from "./virtualGrid";

describe("gridLayout", () => {
  it("fits as many columns as the minimum cell width allows and stretches the cells", () => {
    const l = gridLayout(400, 10, 150, 6);
    expect(l.cols).toBe(2);
    expect(l.cell).toBeCloseTo(197);
    expect(l.rows).toBe(5);
    expect(l.totalHeight).toBeCloseTo(5 * (197 + 6) - 6);
  });
  it("always has one column and copes with no items or no width", () => {
    expect(gridLayout(0, 3).cols).toBe(1);
    expect(gridLayout(100, 0).totalHeight).toBe(0);
  });
});

describe("visibleRange", () => {
  const l = gridLayout(400, 1000, 150, 6); // 2 columns, row height 203
  it("renders the first rows plus overscan at the top", () => {
    expect(visibleRange(l, 0, 600, 1000, 2)).toEqual({ first: 0, last: 10 });
  });
  it("moves with the scroll position", () => {
    const r = visibleRange(l, 203 * 100, 600, 1000, 1);
    expect(r.first).toBe(2 * 99);
    expect(r.last).toBeLessThanOrEqual(1000);
    expect(r.last - r.first).toBeLessThan(20); // a handful of rows, never the whole list
  });
  it("clamps at the end of the list", () => {
    expect(visibleRange(l, 1e9, 600, 1000, 2).last).toBe(1000);
    expect(visibleRange(l, 0, 600, 0)).toEqual({ first: 0, last: 0 });
  });
});

describe("itemPosition / nearEnd", () => {
  const l = gridLayout(400, 10, 150, 6);
  it("places items on the grid", () => {
    expect(itemPosition(l, 0)).toEqual({ x: 0, y: 0 });
    expect(itemPosition(l, 3)).toEqual({ x: l.cell + 6, y: l.rowHeight });
  });
  it("asks for more only near the end", () => {
    expect(nearEnd(l, 0, 300, 1)).toBe(false);
    expect(nearEnd(l, l.totalHeight, 300, 1)).toBe(true);
  });
});
