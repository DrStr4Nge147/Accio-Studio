import { useEffect, useRef, useState } from "react";
import type { Job } from "../api/types";

/**
 * The rewrite the Prompt enhancer made for this job, or null. Only a job that really ran the enhancer has one: with the
 * enhancer off the recorded "prompt used" is just the user's own text, and if the rewrite failed the enhancer falls back to
 * the original prompt, so there is nothing to show either.
 */
export function enhancedText(job: Job): string | null {
  const used = job.prompt_used?.trim();
  if (!used || job.params.prompt_enhancer !== true) return null;
  return used === String(job.params.prompt ?? "").trim() ? null : used;
}

export type JobGroup = "create" | "edit";
export const jobGroup = (job: Job): JobGroup => (job.mode === "create" ? "create" : "edit");

/** "Create · Standard" -> "Standard", "Edit · Inpaint" -> "Inpaint". */
export const shortLabel = (job: Job) => job.label.replace(/^(Create|Edit) · /, "");

/** Output size to reserve for a job: Create's size (template default if unset), or an Edit job's size hint. */
export function jobSize(job: Job): { w: number; h: number } {
  const hint = job.params.size_hint as number[] | undefined;
  if (job.mode !== "create") return hint?.length === 2 ? { w: hint[0]!, h: hint[1]! } : { w: 1024, h: 1024 };
  const detailed = job.params.variant === "detailed";
  if (job.params.variant === "moss") return { w: job.params.width ?? 1920, h: job.params.height ?? 1088 };
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

/** True while the prompt enhancer (a text model) is rewriting the prompt: its "steps" are tokens, not image steps. */
export const isEnhancing = (job: Job) => job.status === "running" && job.live.class === "TextGenerate";

/** True while the latent is being turned into pixels (no step counter exists for it). */
export const isDecoding = (job: Job) => job.status === "running" && (job.live.class === "VAEDecode" || job.live.class === "VAEDecodeTiled");

/**
 * True from the moment a VAE decode starts until sampling steps resume. Decoding is followed by quick nodes
 * (sharpen, save, or resize/encode between the two passes) that must not flip the card back to "summoning".
 */
export function nextDecodePhase(prev: boolean, job: Job): boolean {
  if (job.status !== "running") return false;
  if (isDecoding(job)) return true;
  if (job.live.max !== undefined) return false; // a sampler is stepping again
  return prev;
}

export function useDecodePhase(job: Job): boolean {
  const state = useRef({ id: job.id, decoding: false });
  if (state.current.id !== job.id) state.current = { id: job.id, decoding: false };
  state.current.decoding = nextDecodePhase(state.current.decoding, job);
  return state.current.decoding;
}

/** "42 s", "3 min 05 s", "1 h 02 min": how long a finished job took. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
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
