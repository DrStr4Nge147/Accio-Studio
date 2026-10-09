import { describe, expect, it } from "vitest";
import type { UpdateInfo } from "../api/endpoints";
import { updateView } from "./updateView";

const base: UpdateInfo = { current: "0.1.0", enabled: true, latest: "0.1.0", available: false, notes_url: null, can_apply: false, error: null };

describe("updateView", () => {
  it("says up to date and offers a re-check", () => {
    expect(updateView(base)).toEqual({ title: "Version 0.1.0 · up to date", hint: null, canApply: false, showNotes: false, canRecheck: true });
  });

  it("offers the button only on the PC that runs Accio", () => {
    const newer = { ...base, latest: "0.2.0", available: true, notes_url: "https://example.invalid/r" };
    const local = updateView({ ...newer, can_apply: true });
    expect(local.title).toBe("Version 0.1.0 · update 0.2.0 is available");
    expect(local.canApply).toBe(true);
    expect(local.showNotes).toBe(true);
    const remote = updateView({ ...newer, can_apply: false });
    expect(remote.canApply).toBe(false);
    expect(remote.hint).toContain("Run Update.bat");
  });

  it("shows a calm message when the check failed", () => {
    const v = updateView({ ...base, error: "Could not check for updates right now.", latest: null });
    expect(v.hint).toBe("Could not check for updates right now.");
    expect(v.canRecheck).toBe(true);
    expect(v.canApply).toBe(false);
  });

  it("does nothing when update checks are switched off", () => {
    const v = updateView({ ...base, enabled: false, available: true, latest: "9.9.9", can_apply: true });
    expect(v.canApply).toBe(false);
    expect(v.canRecheck).toBe(false);
    expect(v.title).toBe("Version 0.1.0");
  });
});
