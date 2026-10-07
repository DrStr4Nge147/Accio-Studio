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
  upsert: (jobs: Job[]) => void;
  select: (id: string | null) => void;
  setConnected: (c: boolean) => void;
  setPreview: (url: string | null) => void;
  clearReveal: (id: string) => void;
}

export const useJobs = create<JobsState>((set) => ({
  jobs: {},
  order: [],
  selectedId: null,
  connected: false,
  preview: null,
  reveal: {},
  upsert: (incoming) =>
    set((s) => {
      const jobs = { ...s.jobs };
      const reveal = { ...s.reveal };
      let preview = s.preview;
      for (const j of incoming) {
        const before = jobs[j.id];
        if (before && isActive(before) && j.status === "done") reveal[j.id] = true;
        if (!isActive(j) && before && isActive(before) && preview) {
          URL.revokeObjectURL(preview);
          preview = null;
        }
        jobs[j.id] = j;
      }
      const order = Object.values(jobs)
        .sort((a, b) => b.created_at - a.created_at)
        .map((j) => j.id);
      // A job submitted here becomes selected via select(); otherwise keep the user's choice, else the newest job.
      const selectedId = s.selectedId && jobs[s.selectedId] ? s.selectedId : (order[0] ?? null);
      return { jobs, order, selectedId, reveal, preview };
    }),
  select: (selectedId) => set({ selectedId }),
  setConnected: (connected) => set({ connected }),
  setPreview: (url) =>
    set((s) => {
      if (s.preview) URL.revokeObjectURL(s.preview);
      return { preview: url };
    }),
  clearReveal: (id) =>
    set((s) => {
      const { [id]: _drop, ...reveal } = s.reveal;
      return { reveal };
    }),
}));
