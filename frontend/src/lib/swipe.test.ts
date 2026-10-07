import { describe, expect, it } from "vitest";
import { afterRemoval, dragOutcome, isDragStart, isTap, neighborId, resist } from "./swipe";

describe("isDragStart", () => {
  it("needs a clearly horizontal move", () => {
    expect(isDragStart(14, 2)).toBe(true);
    expect(isDragStart(-14, 3)).toBe(true);
    expect(isDragStart(6, 0)).toBe(false);
    expect(isDragStart(20, 30)).toBe(false);
  });
});

describe("dragOutcome", () => {
  it("commits past a third of the width, in the direction dragged", () => {
    expect(dragOutcome(-150, 400, 0, true, true)).toBe(1); // left: next image
    expect(dragOutcome(150, 400, 0, true, true)).toBe(-1); // right: previous image
    expect(dragOutcome(-100, 400, 0, true, true)).toBe(0);
  });
  it("commits on a quick flick even when short", () => {
    expect(dragOutcome(-40, 400, -0.8, true, true)).toBe(1);
    expect(dragOutcome(-10, 400, -0.8, true, true)).toBe(0);
  });
  it("never goes past either end of the list", () => {
    expect(dragOutcome(-300, 400, -1, true, false)).toBe(0);
    expect(dragOutcome(300, 400, 1, false, true)).toBe(0);
  });
});

describe("resist", () => {
  it("follows the finger when there is a neighbour and slows down at the ends", () => {
    expect(resist(-100, true, true)).toBe(-100);
    expect(resist(100, false, true)).toBeCloseTo(30);
    expect(resist(-100, true, false)).toBeCloseTo(-30);
    expect(resist(-100, false, true)).toBe(-100);
  });
});

describe("isTap", () => {
  it("needs little movement and a short press", () => {
    expect(isTap(2, 3, 120)).toBe(true);
    expect(isTap(20, 0, 120)).toBe(false);
    expect(isTap(0, 0, 900)).toBe(false);
  });
});

describe("neighborId / afterRemoval", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("steps within the list and stops at the ends", () => {
    expect(neighborId(items, "b", 1)).toBe("c");
    expect(neighborId(items, "b", -1)).toBe("a");
    expect(neighborId(items, "a", -1)).toBeNull();
    expect(neighborId(items, "c", 1)).toBeNull();
    expect(neighborId(items, "zzz", 1)).toBeNull();
  });
  it("lands on the item that took the place of a deleted one", () => {
    expect(afterRemoval(items, 1)).toBe("b");
    expect(afterRemoval(items, 7)).toBe("c");
    expect(afterRemoval([], 0)).toBeNull();
  });
});
