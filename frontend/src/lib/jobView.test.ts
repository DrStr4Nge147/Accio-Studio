import { describe, expect, it } from "vitest";
import type { Job } from "../api/types";
import { formatDuration, isEnhancing, nextDecodePhase } from "./jobView";

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

describe("nextDecodePhase", () => {
  const job = (status: string, live: Record<string, unknown>) => ({ status, live }) as unknown as Job;

  it("stays in the decode phase through the quick nodes after a decode, until sampling resumes or the job ends", () => {
    let p = false;
    p = nextDecodePhase(p, job("running", { node: "274:272", class: "VAEDecode" }));
    expect(p).toBe(true);
    p = nextDecodePhase(p, job("running", { node: "141", class: "SaveImage" })); // sharpen / save
    expect(p).toBe(true);
    p = nextDecodePhase(p, job("running", { node: "265", class: "KSampler", step: 1, max: 4 })); // pass 2 starts
    expect(p).toBe(false);
    expect(nextDecodePhase(true, job("done", {}))).toBe(false);
  });
});

describe("isEnhancing", () => {
  const job = (status: string, cls: string | null) => ({ status, live: { class: cls, step: 16, max: 512 } }) as never;
  it("is true only while the text model runs, so its token count is not shown as image steps", () => {
    expect(isEnhancing(job("running", "TextGenerate"))).toBe(true);
    expect(isEnhancing(job("running", "KSampler"))).toBe(false);
    expect(isEnhancing(job("queued", "TextGenerate"))).toBe(false);
  });
});
