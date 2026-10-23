import { describe, expect, it } from "vitest";
import { buildPrompt, isEmpty, LONG_PROMPT_WORDS, randomSelection, wordCount } from "./buildPrompt";
import { FIELDS, type BuilderMode } from "./options";

describe("buildPrompt: character", () => {
  it("assembles subject, traits, clothing, pose, setting, camera and light in order", () => {
    const p = buildPrompt("character", {
      framing: "full-body",
      gender: "woman",
      age: "young-adult",
      ethnicity: "filipino",
      height: "tall",
      build: "athletic",
      hair: "long-black",
      clothing: "trench-coat",
      pose: "walking",
      setting: "city-street",
      lighting: "soft-daylight",
    });
    expect(p).toBe(
      "Full-body photo of a tall young Filipino woman with an athletic build and long black hair wearing a red trench coat, mid-stride walking toward the camera, in a sunlit city street, soft natural daylight.",
    );
  });

  it("uses an for a vowel and falls back to person and photo", () => {
    expect(buildPrompt("character", { ethnicity: "indian" })).toBe("Photo of an Indian person.");
    expect(buildPrompt("character", {})).toBe("Photo of a person.");
  });

  it("leaves out unknown option ids", () => {
    expect(buildPrompt("character", { gender: "woman", hair: "gone-from-the-list" })).toBe("Photo of a woman.");
  });

  it("appends the extra details as the last sentence", () => {
    expect(buildPrompt("character", { gender: "man" }, " holding an umbrella ")).toBe("Photo of a man. holding an umbrella.");
    expect(buildPrompt("character", { gender: "man" }, "Holding an umbrella.")).toBe("Photo of a man. Holding an umbrella.");
  });
});

describe("buildPrompt: scene", () => {
  it("builds layers, light and people", () => {
    const p = buildPrompt("scene", {
      composition: "wide-angle",
      place: "coastline",
      foreground: "wet-rocks",
      distance: "lighthouse",
      time: "golden-hour",
      people: "none",
    });
    expect(p).toBe("Wide-angle photo of a rocky coastline with wet rocks and tide pools in the foreground and a lone lighthouse on a cliff in the distance, at golden hour, no people.");
  });

  it("defaults to a wide landscape", () => {
    expect(buildPrompt("scene", {})).toBe("Wide landscape photo of a scenic landscape.");
  });

  it("keeps people out of the focus when asked for a few", () => {
    expect(buildPrompt("scene", { place: "old-town-street", people: "a-few-distant" })).toContain("not the focus of the image");
  });
});

describe("typed-in text", () => {
  const c = (text: string) => `custom:${text}`;
  it("gets the connecting words for its slot", () => {
    const p = buildPrompt("character", {
      gender: "woman",
      ethnicity: c("Thai"),
      build: c("broad-shouldered"),
      hair: c("messy auburn"),
      clothing: c("a navy raincoat"),
      expression: c("tired"),
      gaze: c("at the sunset"),
      setting: c("a bamboo forest"),
      angle: c("bird's-eye"),
      lens: c("35mm"),
      lighting: c("warm orange sunset glow"),
      mood: c("nostalgic"),
    });
    expect(p).toBe(
      "Photo of a Thai woman with a broad-shouldered build and messy auburn hair wearing a navy raincoat, with a tired expression, looking at the sunset, in a bamboo forest, bird's-eye shot, 35mm lens, warm orange sunset glow, nostalgic atmosphere.",
    );
  });
  it("keeps text that already reads right", () => {
    expect(buildPrompt("character", { hair: c("a buzz cut"), setting: c("on a rooftop"), angle: c("from above"), mood: c("a calm mood") })).toBe(
      "Photo of a person with a buzz cut, on a rooftop, from above, a calm mood.",
    );
  });
  it("wraps scene text", () => {
    expect(buildPrompt("scene", { place: c("volcanic crater lake"), composition: c("drone shot"), time: c("twilight"), people: c("two hikers, small in the frame") })).toBe(
      "Drone shot of a volcanic crater lake, at twilight, two hikers, small in the frame.",
    );
    expect(buildPrompt("scene", { place: c("snowy peaks") })).toBe("Wide landscape photo of snowy peaks.");
  });
  it("tidies spaces and trailing punctuation, and ignores empty or unsupported text", () => {
    expect(buildPrompt("character", { clothing: c("  a red   scarf. ") })).toBe("Photo of a person wearing a red scarf.");
    expect(buildPrompt("character", { clothing: c("   ") })).toBe("Photo of a person.");
    // gender stays on its list, so typed text there is ignored
    expect(buildPrompt("character", { gender: c("girl") })).toBe("Photo of a person.");
    expect(isEmpty({ hair: c("  ") }, "", "character")).toBe(true);
    expect(isEmpty({ hair: c("red") }, "", "character")).toBe(false);
  });
});

describe("typed-in age", () => {
  const age = (t: string) => buildPrompt("character", { age: `custom:${t}`, gender: "woman" });
  it("accepts adult ages and descriptions", () => {
    expect(age("35")).toBe("Photo of a 35-year-old woman.");
    expect(age("42 years old")).toBe("Photo of a 42-year-old woman.");
    expect(age("18")).toBe("Photo of a 18-year-old woman.");
    expect(age("30s")).toBe("Photo of a 30-something woman.");
    expect(age("weathered old")).toBe("Photo of a weathered old woman.");
    expect(age("young 20")).toBe("Photo of a young 20-year-old woman.");
    expect(age("early 30s")).toBe("Photo of an early 30-something woman.");
  });
  it("accepts adult age ranges and refuses ranges that dip under 18", () => {
    expect(age("25-30")).toBe("Photo of a 25-to-30-year-old woman.");
    expect(age("40 to 50 years old")).toBe("Photo of a 40-to-50-year-old woman.");
    expect(age("15-25")).toBe("Photo of a woman.");
  });
  it("refuses a young-sounding number under 18", () => {
    expect(age("young 15")).toBe("Photo of a woman.");
  });
  it("refuses anything under 18 or describing a child or teenager", () => {
    for (const t of ["17", "12 years old", "0", "teenage", "a kid", "little girl", "young boy", "toddler", "5", "16-year-old", "teen"]) expect(age(t), t).toBe("Photo of a woman.");
  });
});

describe("options", () => {
  it("have unique ids per field, and unique field ids per mode", () => {
    for (const mode of Object.keys(FIELDS) as BuilderMode[]) {
      expect(new Set(FIELDS[mode].map((f) => f.id)).size).toBe(FIELDS[mode].length);
      for (const f of FIELDS[mode]) expect(new Set(f.options.map((o) => o.id)).size, `${mode}.${f.id}`).toBe(f.options.length);
    }
  });
  it("only describe adults", () => {
    const ages = FIELDS.character.find((f) => f.id === "age")!.options.map((o) => o.text);
    expect(ages).toEqual(["young", "adult", "middle-aged", "elderly"]);
  });
});

describe("randomSelection", () => {
  it("always fills the core fields, with real option ids", () => {
    for (const mode of ["character", "scene"] as BuilderMode[]) {
      const sel = randomSelection(mode, () => 0.99);
      for (const f of FIELDS[mode]) {
        if (f.core) expect(f.options.map((o) => o.id)).toContain(sel[f.id]);
        else expect(sel[f.id]).toBeUndefined();
      }
    }
  });
  it("fills everything when the dice are low", () => {
    expect(Object.keys(randomSelection("character", () => 0))).toHaveLength(FIELDS.character.length);
  });
  it("makes prompts that stay under the long-prompt limit", () => {
    for (let i = 0; i < 200; i++) for (const mode of ["character", "scene"] as BuilderMode[]) expect(wordCount(buildPrompt(mode, randomSelection(mode))), mode).toBeLessThan(LONG_PROMPT_WORDS + 40);
  });
});

describe("isEmpty", () => {
  it("is true only with nothing chosen and no extra text", () => {
    expect(isEmpty({}, " ", "character")).toBe(true);
    expect(isEmpty({ gender: "woman" }, "", "character")).toBe(false);
    expect(isEmpty({ gender: "stale" }, "", "character")).toBe(true);
    expect(isEmpty({}, "a fox", "scene")).toBe(false);
  });
});
