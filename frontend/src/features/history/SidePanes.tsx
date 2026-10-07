import { Loader2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { requestCancel } from "../../features/create/actions";
import type { Job } from "../../api/types";
import { isEnhancing, jobGroup, shortLabel, type JobGroup } from "../../lib/jobView";
import { isActive, useJobs } from "../../store/jobs";
import { openJob } from "./open";
import { Thumb } from "./Thumb";

function useJobList(filter: (j: Job) => boolean) {
  return useJobs(useShallow((s) => s.order.map((id) => s.jobs[id]!).filter(filter)));
}

export function PaneHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-12 flex-none items-center justify-between border-b border-line px-4">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {hint && <span className="text-[12px] text-text-3">{hint}</span>}
    </div>
  );
}

export function QueuePane() {
  const jobs = [...useJobList(isActive)].reverse(); // oldest (running) first
  const cancelling = useJobs((s) => s.cancelling);
  return (
    <section aria-label="Queue" className="flex-none">
      <PaneHeader title="Queue" hint={jobs.length ? `${jobs.length} job${jobs.length === 1 ? "" : "s"}` : "idle"} />
      {jobs.length > 0 && (
        <ul className="space-y-2 p-3">
          {jobs.map((j) => {
            const { step, max, queue_ahead: ahead } = j.live;
            return (
              <li key={j.id} className="flex items-center gap-2.5 rounded-m border border-line bg-raised p-2 text-[13px]">
                <button type="button" onClick={() => openJob(j)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <Thumb job={j} className="h-10 w-10 flex-none rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{cancelling[j.id] ? "Cancelling…" : isEnhancing(j) ? "Improving prompt" : j.status === "running" ? "Running" : "Waiting"}</span>
                    {j.status === "running" && max && !isEnhancing(j) ? (
                      <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-track">
                        <span className="block h-full rounded-full bg-gold-ui" style={{ width: `${((step ?? 0) / max) * 100}%` }} />
                      </span>
                    ) : (
                      <span className="block truncate text-[12px] text-text-3">
                        {shortLabel(j)}
                        {ahead ? ` · position ${ahead}` : ""}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Cancel job"
                  data-tip="Cancel this job"
                  onClick={() => void requestCancel(j.id)}
                  disabled={!!cancelling[j.id]}
                  className="hover-wash grid h-11 w-11 flex-none place-items-center rounded-full text-text-2 hover:text-text"
                >
                  {cancelling[j.id] ? <Loader2 size={16} strokeWidth={1.7} className="animate-spin motion-reduce:animate-none" /> : <X size={16} strokeWidth={1.7} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function HistoryPane({ group = "create" }: { group?: JobGroup }) {
  const jobs = useJobList((j) => j.status === "done" && jobGroup(j) === group);
  const selectedId = useJobs((s) => s.selectedId);
  return (
    <section aria-label="History" className="flex min-h-0 flex-1 flex-col border-t border-line">
      <PaneHeader title="History" hint={String(jobs.length)} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {jobs.length === 0 ? (
          <p className="p-2 text-[13px] text-text-3">Finished images show up here.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => openJob(j)}
                  aria-label={`Open: ${String(j.params.prompt ?? j.label).slice(0, 60)}`}
                  aria-current={j.id === selectedId}
                  data-tip={String(j.params.prompt ?? j.label).slice(0, 140)}
                  className={`block aspect-square w-full overflow-hidden rounded-s border ${j.id === selectedId ? "border-gold" : "border-line hover:border-text-3"}`}
                >
                  <Thumb job={j} className="h-full w-full" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** "Recent" strip under the canvas: flip through the latest results without opening the gallery. */
export function RecentStrip({ group = "create", compact }: { group?: JobGroup; compact?: boolean }) {
  const jobs = useJobList((j) => (j.status === "done" || isActive(j)) && jobGroup(j) === group).slice(0, 10); // running jobs first, newest first
  const selectedId = useJobs((s) => s.selectedId);
  if (!jobs.length) return null;
  return (
    <div className={`flex flex-none items-center gap-2 overflow-x-auto no-scrollbar ${compact ? "px-3.5 pb-2" : "px-4 pb-3.5"}`} aria-label="Recent results">
      {jobs.map((j) => (
        <button
          key={j.id}
          type="button"
          aria-label={isActive(j) ? "Show the image being generated" : "Show this result"}
          aria-current={j.id === selectedId}
          data-tip={isActive(j) ? "Being generated" : String(j.params.prompt ?? j.label).slice(0, 140)}
          onClick={() => openJob(j)}
          className={`${compact ? "h-11 w-11" : "h-[72px] w-[72px]"} flex-none overflow-hidden rounded-s border ${j.id === selectedId ? "border-gold" : "border-line-strong hover:border-text-3"}`}
        >
          <Thumb job={j} className="h-full w-full" />
        </button>
      ))}
      <span className="ml-1.5 text-[12px] text-text-3">Recent</span>
    </div>
  );
}
