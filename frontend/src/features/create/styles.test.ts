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
    expect(withStyle("a fox", "Soft watercolor.", true)).toBe("Soft watercolor. a fox");
    expect(withStyle("a fox", "Soft watercolor", true)).toBe("Soft watercolor. a fox");
  });
});

describe("styleText", () => {
  it("is the compact text by default and the full descriptor on request", async () => {
    const s = (await loadStyles())[0]!;
    expect(styleText(s)).toBe(s.compact);
    expect(styleText(s, false)).toBe(s.descriptor);
  });
  it("still recognizes the older name-prefixed wording on reuse", async () => {
    const styles = await loadStyles();
    const s = styles[0]!;
    expect(splitStyle(`a fox. ${s.name}. ${s.descriptor}`, styles)).toMatchObject({ prompt: "a fox", style: s, opts: { compact: false } });
  });
});

describe("splitStyle", () => {
  it("round-trips every library style", async () => {
    const styles = await loadStyles();
    expect(styles.length).toBeGreaterThan(200);
    for (const s of [styles[0]!, styles[styles.length - 1]!]) {
      for (const prompt of ["a fox", "a fox!", ""]) {
        for (const compact of [false, true]) {
          for (const first of [false, true]) {
            const out = splitStyle(withStyle(prompt, styleText(s, compact), first), styles);
            expect(out.style?.id).toBe(s.id);
            expect(out.prompt).toBe(prompt);
            expect(out.opts).toEqual({ compact, first: prompt ? first : false });
          }
        }
      }
    }
  });
  it("returns a plain prompt untouched", async () => {
    expect(splitStyle("a fox", await loadStyles())).toMatchObject({ prompt: "a fox", style: null });
  });
});
