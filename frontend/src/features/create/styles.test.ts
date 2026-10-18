import { describe, expect, it } from "vitest";
import { loadStyles, splitStyle, styleText, withStyle } from "./styles";

describe("withStyle", () => {
  it("appends the descriptor after the prompt as its own sentence", () => {
    expect(withStyle("a fox", "Soft watercolor.")).toBe("a fox. Soft watercolor.");
    expect(withStyle("a fox.", "Soft watercolor.")).toBe("a fox. Soft watercolor.");
    expect(withStyle("  a fox, ", "Soft watercolor.")).toBe("a fox, Soft watercolor.");
  });
  it("leaves the prompt alone without a style", () => {
    expect(withStyle(" a fox ", undefined)).toBe("a fox");
  });
});

describe("styleText", () => {
  it("puts the style name before its descriptor", async () => {
    const s = (await loadStyles())[0]!;
    expect(styleText(s)).toBe(`${s.name}. ${s.descriptor}`);
  });
});

describe("splitStyle", () => {
  it("round-trips every library style", async () => {
    const styles = await loadStyles();
    expect(styles.length).toBeGreaterThan(200);
    for (const s of [styles[0]!, styles[styles.length - 1]!]) {
      for (const prompt of ["a fox", "a fox!", ""]) {
        const out = splitStyle(withStyle(prompt, styleText(s)), styles);
        expect(out.style?.id).toBe(s.id);
        expect(out.prompt).toBe(prompt);
      }
    }
  });
  it("returns a plain prompt untouched", async () => {
    expect(splitStyle("a fox", await loadStyles())).toEqual({ prompt: "a fox", style: null });
  });
});
