import { describe, expect, it } from "vitest";
import type { SystemInfo } from "../api/endpoints";
import { comfortableMp, loadHint } from "./loadHint";

const pc = (vram_mb: number | null, ram_mb: number | null = 32768): SystemInfo => ({
  gpus: [{ name: "NVIDIA GeForce RTX 2060", vram_mb, driver: "1" }],
  driver_cuda: "13.0",
  engine_cuda: "13.0",
  ram_mb,
});

describe("loadHint", () => {
  it("stays quiet when the card is unknown", () => {
    expect(loadHint(null, 12)).toBeNull();
    expect(loadHint(pc(null), 12)).toBeNull();
  });

  it("does not warn at the default 16:9 size on a 6 GB card", () => {
    expect(loadHint(pc(6144), 2.07)).toBeNull();
  });

  it("warns above the comfortable size, more strongly far above it", () => {
    expect(loadHint(pc(6144), 3.5)?.level).toBe("heavy");
    expect(loadHint(pc(6144), 8)?.level).toBe("extreme");
    expect(loadHint(pc(6144), 3.5)?.text).toContain("RTX 2060 (6 GB)");
  });

  it("allows more on a bigger card and less on low RAM", () => {
    expect(loadHint(pc(24576), 8)).toBeNull();
    expect(comfortableMp(pc(6144, 8192))).toBeLessThan(comfortableMp(pc(6144))!);
  });
});
