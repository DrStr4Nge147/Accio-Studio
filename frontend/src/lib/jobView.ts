import { useEffect, useRef, useState } from "react";
import type { Job } from "../api/types";

/** Output size of a Create job (the template default when the request didn't set one). */
export function jobSize(job: Job): { w: number; h: number } {
  const detailed = job.params.variant === "detailed";
  return { w: job.params.width ?? (detailed ? 1920 : 1080), h: job.params.height ?? (detailed ? 1080 : 1920) };
}

/** Which sampler pass is running (Detailed only): KSampler nodes 273 (pass 1) and 265 (pass 2). */
export function passOf(job: Job): { pass: 1 | 2; of: 2 } | null {
  if (!job.template.startsWith("krea_combo")) return null;
  const node = job.live.node;
  if (node === "273") return { pass: 1, of: 2 };
  if (node === "265") return { pass: 2, of: 2 };
  return null;
}

export function formatEta(seconds: number): string {
  if (seconds < 8) return "a few seconds";
  if (seconds < 90) return `about ${Math.round(seconds / 5) * 5} s`;
  return `about ${Math.round(seconds / 60)} min`;
}

/** Seconds left in the current sampler pass, from the observed time per step. Null until two steps were seen. */
export function useEta(job: Job): number | null {
  const marks = useRef<{ node?: string; first?: { step: number; t: number } }>({});
  const [eta, setEta] = useState<number | null>(null);
  const { node, step, max } = job.live;
  useEffect(() => {
    if (node !== marks.current.node) marks.current = { node };
    if (step === undefined || max === undefined) return setEta(null);
    const now = performance.now();
    const first = (marks.current.first ??= { step, t: now });
    const done = step - first.step;
    setEta(done >= 1 ? ((now - first.t) / 1000 / done) * (max - step) : null);
  }, [node, step, max]);
  return job.status === "running" ? eta : null;
}
