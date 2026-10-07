import { AlertTriangle, RotateCcw } from "lucide-react";
import type { Job } from "../../api/types";
import { generate } from "../../features/create/actions";
import { reuseJob } from "../../features/create/params";
import { useCreate } from "../../features/create/store";
import { useServer } from "../../store/health";
import { isActive, useJobs } from "../../store/jobs";
import { Ring } from "../Wordmark";
import { ResultView } from "./ResultView";
import { RunningCard } from "./RunningCard";

export function EmptyStage() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-xs">
        <Ring className="mx-auto h-14 w-14 text-text-3" />
        <h2 className="serif mt-5 text-[22px] font-medium text-text">Describe it, then summon it</h2>
        <p className="mt-2 text-[14px] text-text-2">
          Write a prompt below and press Generate. Results appear here as they resolve, and every image keeps its seeds
          so you can reuse the exact settings later.
        </p>
      </div>
    </div>
  );
}

function Problem({ job, title }: { job: Job; title: string }) {
  const catalog = useServer((s) => s.catalog);
  const retry = () => {
    reuseJob(job, catalog?.defaults ?? null);
    useCreate.getState().patch({ lockSeed: false }); // a retry draws fresh seeds
    void generate();
  };
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-sm rounded-l border border-line bg-surface p-5 text-center">
        <AlertTriangle size={24} strokeWidth={1.7} className="mx-auto text-danger" />
        <h3 className="mt-3 text-[16px] font-semibold">{title}</h3>
        {job.error && <p className="mt-1.5 text-[14px] text-text-2">{job.error}</p>}
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={retry} className="flex h-11 items-center gap-2 rounded-full bg-raised px-4 text-[14px] font-medium">
            <RotateCcw size={16} strokeWidth={1.7} /> Try again
          </button>
          <button
            type="button"
            onClick={() => reuseJob(job, catalog?.defaults ?? null)}
            className="h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2"
          >
            Reuse settings
          </button>
        </div>
      </div>
    </div>
  );
}

/** The result slot for one job, whatever its state. */
export function JobStage({ job }: { job: Job | undefined }) {
  if (!job) return <EmptyStage />;
  if (isActive(job)) return <RunningCard job={job} />;
  if (job.status === "done") return <ResultView key={job.id} job={job} />;
  return <Problem job={job} title={job.status === "cancelled" ? "Cancelled" : "That job didn't finish"} />;
}

export function SelectedStage() {
  const job = useJobs((s) => (s.selectedId ? s.jobs[s.selectedId] : undefined));
  return <JobStage job={job} />;
}
