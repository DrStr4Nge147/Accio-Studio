import { describe, expect, it } from "vitest";
import { editStyleText, loadStyles, splitEditStyle, splitStyle, styleText, withStyle } from "./styles";

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
    expect(styleText(s)).toBe(`Art style: ${s.compact}`);
    expect(styleText(s, false)).toBe(`Art style: ${s.descriptor}`);
  });
  it("still recognizes the older unlabeled wordings on reuse", async () => {
    const styles = await loadStyles();
    const s = styles[0]!;
    expect(splitStyle(`a fox. ${s.compact}`, styles)).toMatchObject({ prompt: "a fox", style: s, opts: { compact: true } });
    expect(splitStyle(`a fox. ${s.descriptor}`, styles)).toMatchObject({ prompt: "a fox", style: s, opts: { compact: false } });
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

describe("editStyleText", () => {
  it("is the restyle instruction around the style description", async () => {
    const s = (await loadStyles()).find((x) => x.id === "anime-style")!;
    const t = editStyleText(s);
    expect(t.startsWith("Transform the entire input image into Anime Style. Preserve the original subject identity")).toBe(true);
    expect(t).toContain(`with these visual characteristics: ${s.descriptor} Keep the result visually coherent`);
    expect(t.endsWith("unless specifically requested.")).toBe(true);
    expect(editStyleText(s, true)).toContain(`characteristics: ${s.compact}. Keep the result`);
  });
  it("round-trips through splitEditStyle in every wording and order", async () => {
    const styles = await loadStyles();
    for (const s of [styles[0]!, styles[100]!, styles[styles.length - 1]!]) {
      for (const compact of [false, true]) {
        for (const first of [false, true]) {
          const out = splitEditStyle(withStyle("make her smile", editStyleText(s, compact), first), styles);
          expect(out.style?.id).toBe(s.id);
          expect(out.prompt).toBe("make her smile");
          expect(out.opts).toEqual({ compact, first });
        }
      }
    }
  });
  it("leaves a plain Edit prompt alone", async () => {
    expect(splitEditStyle("replace the jacket", await loadStyles())).toMatchObject({ prompt: "replace the jacket", style: null });
  });
});
