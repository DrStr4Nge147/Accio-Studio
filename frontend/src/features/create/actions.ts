import { create } from "zustand";
import { ApiError } from "../../api/http";
import { cancelJob, submitJob } from "../../api/endpoints";
import { useServer } from "../../store/health";
import { isActive, useJobs } from "../../store/jobs";
import { useUi } from "../../store/ui";
import type { Job } from "../../api/types";
import { buildParams, reuseJob, validate } from "./params";
import { useCreate } from "./store";

interface SubmitState {
  busy: boolean;
  error: string | null;
  setError: (e: string | null) => void;
}
/** Transient submit state (the job itself is tracked by the jobs store, fed from the WebSocket). */
export const useSubmit = create<SubmitState>((set) => ({ busy: false, error: null, setError: (error) => set({ error }) }));

export async function generate() {
  const submit = useSubmit.getState();
  if (submit.busy) return;
  const s = useCreate.getState();
  const problem = validate(s);
  if (problem) return submit.setError(problem);
  useSubmit.setState({ busy: true, error: null });
  try {
    const job = await submitJob(buildParams(s, useServer.getState().catalog?.defaults ?? null));
    const jobs = useJobs.getState();
    const busyBefore = Object.values(jobs.jobs).some(isActive);
    jobs.upsert([job]);
    if (!busyBefore) jobs.select(job.id); // a queued job does not take the canvas from the one running
    useUi.getState().set({ viewerOpen: true });
    const last = { ...s.loraLastMode };
    for (const l of s.loras) last[l.name] = "create";
    s.patch({ loraLastMode: last });
  } catch (e) {
    useSubmit.setState({ error: e instanceof ApiError ? e.message : "Couldn't start the job." });
  } finally {
    useSubmit.setState({ busy: false });
  }
}

/** "Reuse settings": load the job's settings into the composer and clear the canvas for the next image. */
export function reuseSettings(job: Job) {
  reuseJob(job, useServer.getState().catalog?.defaults ?? null);
  useJobs.getState().select(null);
  useUi.getState().set({ viewerOpen: false });
}

/** Ask the server to cancel a job. The UI shows "cancelling" until the job's status actually changes. */
export async function requestCancel(id: string) {
  const jobs = useJobs.getState();
  if (jobs.cancelling[id]) return;
  jobs.setCancelling(id, true);
  try {
    await cancelJob(id);
  } catch (e) {
    useJobs.getState().setCancelling(id, false);
    useSubmit.setState({ error: e instanceof ApiError ? e.message : "Couldn't cancel the job." });
  }
}

/** Cancel the job on screen if it is active, otherwise the oldest of our active jobs. */
export async function cancelCurrent() {
  const { jobs, order, selectedId } = useJobs.getState();
  const sel = selectedId ? jobs[selectedId] : undefined;
  const target = isActive(sel) ? sel : order.map((id) => jobs[id]).reverse().find(isActive);
  if (target) await requestCancel(target.id);
}
