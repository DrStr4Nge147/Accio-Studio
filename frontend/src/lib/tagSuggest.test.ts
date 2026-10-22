import { describe, expect, it } from "vitest";
import { applyAt, applyTag, detectAtTrigger, detectTagTrigger } from "./tagSuggest";

describe("detectTagTrigger", () => {
  it("fires on <, <im..., and a bare im / image / imageN at the caret", () => {
    for (const [text, tok] of [["swap <", "<"], ["swap <ima", "<ima"], ["swap <image2", "<image2"], ["use im", "im"], ["use image", "image"], ["use image3", "image3"], ["image", "image"]] as const) {
      const t = detectTagTrigger(text, text.length);
      expect(t, text).not.toBeNull();
      expect(text.slice(t!.start, t!.end)).toBe(tok);
    }
  });
  it("reads the digits typed after image", () => {
    expect(detectTagTrigger("a image12", 9)?.digits).toBe("12");
    expect(detectTagTrigger("a <image", 8)?.digits).toBe("");
  });
  it("ignores ordinary words and a bare i", () => {
    for (const text of ["i", "an i", "image of a cat", "imagine", "slim", "x<image1>", "email", "a <image1>"]) expect(detectTagTrigger(text, text.length), text).toBeNull();
  });
  it("only looks at the text before the caret", () => {
    expect(detectTagTrigger("swap im the head", 7)?.start).toBe(5);
  });
});

describe("applyTag", () => {
  it("replaces the token with a finished tag and a space", () => {
    const t = detectTagTrigger("swap the head of im", 19)!;
    expect(applyTag("swap the head of im", t, 2)).toEqual({ text: "swap the head of <image2> ", caret: 26 });
  });
  it("keeps the text after the caret", () => {
    const text = "keep <im and more";
    const t = detectTagTrigger(text, 8)!;
    expect(applyTag(text, t, 1).text).toBe("keep <image1>  and more");
  });
  it("absorbs the tail of a tag that was already half typed after the caret", () => {
    const text = "from <image>";
    const t = detectTagTrigger(text, 11)!;
    expect(applyTag(text, t, 3).text).toBe("from <image3> ");
  });
});

describe("detectAtTrigger", () => {
  it("finds a bare @ and a partial word at the caret", () => {
    expect(detectAtTrigger("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(detectAtTrigger("a cat, @gh", 10)).toEqual({ start: 7, end: 10, query: "gh" });
  });
  it("ignores an @ inside a word such as an e-mail address", () => {
    expect(detectAtTrigger("me@site", 7)).toBeNull();
  });
  it("ignores an @ the caret has already left", () => {
    expect(detectAtTrigger("@ghibli and more", 16)).toBeNull();
  });
});

describe("applyAt", () => {
  it("replaces the typed token with the words and a space", () => {
    const t = detectAtTrigger("a cat, @gh", 10)!;
    expect(applyAt("a cat, @gh", t, " ghibli style ")).toEqual({ text: "a cat, ghibli style ", caret: 20 });
  });
  it("keeps the text after the caret", () => {
    const t = detectAtTrigger("@ at the end", 1)!;
    expect(applyAt("@ at the end", t, "zz")).toEqual({ text: "zz  at the end", caret: 3 });
  });
});
