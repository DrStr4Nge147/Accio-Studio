import { create } from "zustand";
import type { Job } from "../api/types";
import { useUi } from "../store/ui";
import { generate, reuseSettings } from "./create/actions";
import { reuseJob } from "./create/params";
import { useCreate } from "./create/store";
import { generateEdit, reuseEdit } from "./edit/actions";
import { useEdit, type EditMode } from "./edit/store";
import { useServer } from "../store/health";

/** The job waiting on the "same seed or not?" question after "Reuse settings" was clicked. */
export const useReusePrompt = create<{ job: Job | null; ask: (job: Job) => void; close: () => void }>((set) => ({
  job: null,
  ask: (job) => set({ job }),
  close: () => set({ job: null }),
}));

/** "Reuse settings": ask whether to keep the job's seed, then load its settings into its mode's composer. */
export function reuseAny(job: Job) {
  useReusePrompt.getState().ask(job);
}

/** Load a job's settings into its mode's composer and clear the canvas; the seed is kept only when asked. */
export function applyReuse(job: Job, keepSeed: boolean) {
  useReusePrompt.getState().close();
  if (job.mode === "create") {
    useUi.getState().set({ tab: "create" });
    reuseSettings(job, keepSeed);
  } else {
    void reuseEdit(job, keepSeed);
  }
}

/** "Try again" on a failed job: same settings, fresh seed. */
export async function retryAny(job: Job) {
  if (job.mode === "create") {
    reuseJob(job, useServer.getState().catalog?.defaults ?? null);
    useCreate.getState().patch({ lockSeed: false });
    await generate();
    return;
  }
  await reuseEdit(job);
  useEdit.getState().setSeed(job.mode as EditMode, false, null);
  await generateEdit();
}
