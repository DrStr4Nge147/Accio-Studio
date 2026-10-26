import { describe, expect, it } from "vitest";
import type { ModelRow, ModelsData } from "../api/endpoints";
import { formatSize, groupModels, isHave, missingIds, percent, stateText, summary } from "./modelsView";

const row = (id: string, over: Partial<ModelRow> = {}): ModelRow => ({
  id,
  size: 1000,
  folder: "loras",
  required: true,
  group: null,
  used_by: "Create",
  state: "missing",
  bytes: 0,
  ...over,
});

describe("modelsView", () => {
  it("formats sizes in decimal units", () => {
    expect(formatSize(13_492_686_496)).toBe("13.5 GB");
    expect(formatSize(253_806_246)).toBe("254 MB");
    expect(formatSize(10)).toBe("1 KB");
  });

  it("sorts models into required, Klein, MOSS and preset cards and drops empty ones", () => {
    const rows = [row("a"), row("k", { required: false, group: "klein" }), row("m", { required: false, group: "moss" }), row("p", { required: false })];
    expect(groupModels(rows).map((g) => [g.id, g.rows.map((r) => r.id)])).toEqual([["required", ["a"]], ["klein", ["k"]], ["moss", ["m"]], ["presets", ["p"]]]);
    expect(groupModels([row("a")]).map((g) => g.id)).toEqual(["required"]);
  });

  it("offers only what is neither installed nor on its way", () => {
    const rows = [row("a", { state: "installed" }), row("b", { state: "linked" }), row("c"), row("d", { state: "partial", bytes: 5 }), row("e", { state: "damaged" }), row("f", { state: "downloading" }), row("g", { state: "queued" })];
    expect(missingIds(rows)).toEqual(["c", "d", "e"]);
    expect(rows.filter(isHave).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("shows progress only for partial and running downloads, never past 100", () => {
    expect(percent(row("a", { state: "downloading", bytes: 250 }))).toBe(25);
    expect(percent(row("a", { state: "partial", bytes: 5000 }))).toBe(100);
    expect(percent(row("a"))).toBeNull();
    expect(stateText(row("a", { state: "downloading", bytes: 500 }))).toBe("Downloading 50%");
    expect(stateText(row("a", { state: "partial", bytes: 100 }))).toBe("Paused at 10%");
  });

  it("summarises the missing required models", () => {
    const data = (models: ModelRow[]): ModelsData => ({ available: true, models, free_bytes: 0, job: { state: "idle", queue: [], current: null, done: [], failed: [], message: "" } });
    expect(summary(data([row("a", { state: "installed" })]))).toBe("All required models are installed.");
    expect(summary(data([row("a", { size: 2e9 }), row("b", { size: 1e9, state: "partial", bytes: 5e8 }), row("c", { required: false })]))).toBe(
      "2 required models are missing (2.5 GB to download).",
    );
  });
});
