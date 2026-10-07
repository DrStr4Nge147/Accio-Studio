import { X } from "lucide-react";
import type { Job } from "../../api/types";
import { cancelJob } from "../../api/endpoints";
import { formatEta, jobSize, passOf, useEta } from "../../lib/jobView";
import { useJobs } from "../../store/jobs";
import { Ring } from "../Wordmark";
import { Box } from "./Box";

/** Where the result will land: live preview, step X/Y, pass, ETA and queue position, with Cancel in place. */
export function RunningCard({ job, compact }: { job: Job; compact?: boolean }) {
  const preview = useJobs((s) => s.preview);
  const eta = useEta(job);
  const { w, h } = jobSize(job);
  const { step, max, queue_ahead: ahead } = job.live;
  const queued = job.status === "queued" || (job.live.node === undefined && !max);
  const pass = passOf(job);
  const pct = max ? Math.min(100, ((step ?? 0) / max) * 100) : 0;
  const waiting = ahead ? `${ahead} job${ahead === 1 ? "" : "s"} ahead in the queue` : null;

  return (
    <Box w={w} h={h} className="shimmer overflow-hidden rounded-m border border-line bg-raised">
      {preview && job.status === "running" ? (
        <img src={preview} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-90 blur-[14px] saturate-125" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-text-3">
          <Ring className="h-14 w-14 animate-pulse motion-reduce:animate-none" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-[rgba(8,7,12,0.9)] to-transparent p-3.5 pt-10 text-[#f1eadb]">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px] font-medium">
          <span>{queued ? "Waiting for the GPU…" : "Summoning…"}</span>
          {max ? (
            <span className="font-mono text-gold-hi">
              step {step ?? 0}/{max}
              {pass && ` · pass ${pass.pass} of ${pass.of}`}
            </span>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-label="Generation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="h-[3px] overflow-hidden rounded-full bg-white/20"
        >
          <div className="h-full rounded-full bg-gold transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-[#b9b2a3]">
          <span>
            {[eta !== null && !compact ? `${formatEta(eta)} left in this pass` : null, waiting].filter(Boolean).join(" · ") ||
              (queued ? "Starting…" : "Working…")}
          </span>
          <button
            type="button"
            onClick={() => void cancelJob(job.id).catch(() => undefined)}
            className="-my-3 flex h-11 items-center gap-1 rounded-full px-2.5 text-[12px] text-[#f1eadb]"
          >
            <X size={14} strokeWidth={1.7} /> Cancel
          </button>
        </div>
      </div>
    </Box>
  );
}
