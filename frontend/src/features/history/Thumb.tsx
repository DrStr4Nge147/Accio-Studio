import { Ring } from "../../components/Wordmark";
import { imageUrl } from "../../api/http";
import type { Job } from "../../api/types";

/** Index of the image to show for a job: its first final output. */
export const coverIndex = (job: Job) => {
  const i = job.outputs.findIndex((o) => o.role === "final");
  return i >= 0 ? i : 0;
};

/**
 * Job thumbnail. Until the gallery phase adds server-side thumbnails this loads the full image lazily, so keep
 * the number of thumbnails on screen small.
 */
export function Thumb({ job, className = "" }: { job: Job; className?: string }) {
  const has = job.status === "done" && job.outputs.length > 0;
  return (
    <div className={`relative overflow-hidden bg-raised ${className}`}>
      {has ? (
        <img src={imageUrl(job.id, coverIndex(job))} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-text-3">
          <Ring className="h-1/2 w-1/2" spark={job.status !== "error"} />
        </div>
      )}
    </div>
  );
}
