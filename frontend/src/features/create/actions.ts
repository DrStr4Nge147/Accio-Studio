import { create } from "zustand";
import { ApiError } from "../../api/http";
import { cancelJob, submitJob } from "../../api/endpoints";
import { useServer } from "../../store/health";
import { isActive, useJobs } from "../../store/jobs";
import { useUi } from "../../store/ui";
import { buildParams, validate } from "./params";
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
    useJobs.getState().upsert([job]);
    useJobs.getState().select(job.id);
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

/** Cancel the job on screen if it is active, otherwise the oldest of our active jobs. */
export async function cancelCurrent() {
  const { jobs, order, selectedId } = useJobs.getState();
  const sel = selectedId ? jobs[selectedId] : undefined;
  const target = isActive(sel) ? sel : order.map((id) => jobs[id]).reverse().find(isActive);
  if (target) await cancelJob(target.id).catch(() => undefined);
}
