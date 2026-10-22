import { describe, expect, it } from "vitest";
import { splitWords } from "./triggerWords";

describe("splitWords", () => {
  it("splits on commas, trims and drops blanks and repeats", () => {
    expect(splitWords("ghibli style, soft pastel ,, ghibli style")).toEqual(["ghibli style", "soft pastel"]);
  });
  it("returns nothing for blank input", () => {
    expect(splitWords("  , ")).toEqual([]);
  });
});
