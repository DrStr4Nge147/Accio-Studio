import { create } from "zustand";
import type { Job } from "../api/types";

const ACTIVE = new Set(["queued", "running"]);
export const isActive = (j: Job | null | undefined) => !!j && ACTIVE.has(j.status);

interface JobsState {
  jobs: Record<string, Job>;
  /** Job ids, newest first. */
  order: string[];
  selectedId: string | null;
  connected: boolean;
  /** Blob URL of the latest live preview frame for the running job. */
  preview: string | null;
  /** Jobs that finished while we were watching: they get the summon reveal once. */
  reveal: Record<string, true>;
  /** Jobs whose cancel was requested and has not taken effect yet (the UI shows "cancelling"). */
  cancelling: Record<string, true>;
  upsert: (jobs: Job[]) => void;
  /** Forget jobs that were deleted from the history. */
  remove: (ids: string[]) => void;
  select: (id: string | null) => void;
  setConnected: (c: boolean) => void;
  setPreview: (url: string | null) => void;
  clearReveal: (id: string) => void;
  setCancelling: (id: string, on: boolean) => void;
}

export const useJobs = create<JobsState>((set) => ({
  jobs: {},
  order: [],
  selectedId: null,
  connected: false,
  preview: null,
  reveal: {},
  cancelling: {},
  upsert: (incoming) =>
    set((s) => {
      const jobs = { ...s.jobs };
      const reveal = { ...s.reveal };
      const cancelling = { ...s.cancelling };
      let preview = s.preview;
      for (const j of incoming) {
        const before = jobs[j.id];
        if (before && isActive(before) && j.status === "done") reveal[j.id] = true;
        if (!isActive(j) && before && isActive(before) && preview) {
          URL.revokeObjectURL(preview);
          preview = null;
        }
        jobs[j.id] = j;
        if (!isActive(j)) delete cancelling[j.id]; // the cancel took effect (or the job ended anyway)
      }
      const order = Object.values(jobs)
        .sort((a, b) => b.created_at - a.created_at)
        .map((j) => j.id);
      // Nothing is selected until a job is generated here or picked from the history: no selection = blank canvas.
      const selectedId = s.selectedId && jobs[s.selectedId] ? s.selectedId : null;
      return { jobs, order, selectedId, reveal, preview, cancelling };
    }),
  remove: (ids) =>
    set((s) => {
      const gone = new Set(ids);
      const jobs = Object.fromEntries(Object.entries(s.jobs).filter(([id]) => !gone.has(id)));
      return { jobs, order: s.order.filter((id) => !gone.has(id)), selectedId: s.selectedId && gone.has(s.selectedId) ? null : s.selectedId };
    }),
  select: (selectedId) => set({ selectedId }),
  setConnected: (connected) => set({ connected }),
  setPreview: (url) =>
    set((s) => {
      if (s.preview) URL.revokeObjectURL(s.preview);
      return { preview: url };
    }),
  setCancelling: (id, on) =>
    set((s) => {
      const { [id]: _drop, ...rest } = s.cancelling;
      return { cancelling: on ? { ...rest, [id]: true } : rest };
    }),
  clearReveal: (id) =>
    set((s) => {
      const { [id]: _drop, ...reveal } = s.reveal;
      return { reveal };
    }),
}));
