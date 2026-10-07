import { describe, expect, it } from "vitest";
import { formatDuration } from "./jobView";

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(41.6)).toBe("42 s");
    expect(formatDuration(60)).toBe("1 min 00 s");
    expect(formatDuration(222)).toBe("3 min 42 s");
    expect(formatDuration(3720)).toBe("1 h 02 min");
    expect(formatDuration(-5)).toBe("0 s");
  });
});
