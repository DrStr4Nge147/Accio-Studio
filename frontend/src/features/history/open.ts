import type { Job } from "../../api/types";
import { useJobs } from "../../store/jobs";
import { useUi } from "../../store/ui";
import { useEdit, type EditMode } from "../edit/store";

/** Show a job on the canvas (and, for Edit jobs, switch to the mode it was made in). */
export function openJob(job: Job) {
  useJobs.getState().select(job.id);
  useUi.getState().set({ viewerOpen: true, tab: job.mode === "create" ? "create" : "edit" });
  if (job.mode !== "create") useEdit.getState().patch({ mode: job.mode as EditMode });
}
