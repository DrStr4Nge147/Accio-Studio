import { Ring } from "../../components/Wordmark";
import { imageUrl } from "../../api/http";
import type { Job } from "../../api/types";
import { isActive } from "../../store/jobs";

/** Index of the image to show for a job: its first final output. */
export const coverIndex = (job: Job) => {
  const i = job.outputs.findIndex((o) => o.role === "final");
  return i >= 0 ? i : 0;
};

/**
 * Job thumbnail (a cached WebP from the server, 384 px by default; pass 1024 for big tiles). A job that is still
 * generating gets the same sliding light as its canvas card.
 */
export function Thumb({ job, className = "", size = 384 }: { job: Job; className?: string; size?: 384 | 1024 }) {
  const has = job.status === "done" && job.outputs.length > 0;
  return (
    <div className={`relative overflow-hidden bg-raised ${isActive(job) ? "shimmer" : ""} ${className}`}>
      {has ? (
        <img src={imageUrl(job.id, coverIndex(job), size)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-text-3">
          <Ring className="h-1/2 w-1/2" spark={job.status !== "error"} />
        </div>
      )}
    </div>
  );
}
