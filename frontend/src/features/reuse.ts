import type { Job } from "../api/types";
import { useUi } from "../store/ui";
import { generate, reuseSettings } from "./create/actions";
import { reuseJob } from "./create/params";
import { useCreate } from "./create/store";
import { generateEdit, reuseEdit } from "./edit/actions";
import { useEdit, type EditMode } from "./edit/store";
import { useServer } from "../store/health";

/** "Reuse settings": load a job's settings (and seeds) into its mode's composer and clear the canvas. */
export function reuseAny(job: Job) {
  if (job.mode === "create") {
    useUi.getState().set({ tab: "create" });
    reuseSettings(job);
  } else {
    void reuseEdit(job);
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
