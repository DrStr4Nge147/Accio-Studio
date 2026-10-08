import { Loader2, X } from "lucide-react";
import type { Job } from "../../api/types";
import { requestCancel } from "../../features/create/actions";
import { useBeforeUrl, useMaskPreviewUrl } from "../../features/edit/useBefore";
import { formatEta, isEnhancing, jobSize, passOf, useDecodePhase, useEta } from "../../lib/jobView";
import { useJobs } from "../../store/jobs";
import { Ring } from "../Wordmark";
import { Box } from "./Box";

// A few small bubbles, fixed so the card looks the same on every render. x = left edge in %, s = size, d = rise time.
const BUBBLES = [
  { x: 8, s: 6, d: 9, delay: -2, sway: 6 },
  { x: 19, s: 10, d: 12, delay: -7, sway: 9 },
  { x: 31, s: 5, d: 8, delay: -4, sway: 5 },
  { x: 44, s: 8, d: 11, delay: -9, sway: 8 },
  { x: 57, s: 5, d: 9.5, delay: -1, sway: 6 },
  { x: 68, s: 9, d: 13, delay: -6, sway: 10 },
  { x: 79, s: 6, d: 10, delay: -3, sway: 6 },
  { x: 90, s: 7, d: 12, delay: -8, sway: 7 },
];

function Bubbles() {
  return (
    <div className="bubbles pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden>
      {BUBBLES.map((b) => (
        <span
          key={b.x}
          className="bubble-col"
          style={{ ["--x" as string]: `${b.x}%`, ["--s" as string]: `${b.s}px`, ["--d" as string]: `${b.d}s`, ["--delay" as string]: `${b.delay}s`, ["--sway" as string]: `${b.sway}px` }}
        >
          <i className="bubble" />
        </span>
      ))}
    </div>
  );
}

function Ripples() {
  return (
    <div className="ripples pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden>
      {[0, -1.2, -2.4].map((i) => (
        <span key={i} className="ripple" style={{ ["--i" as string]: `${i}s` }} />
      ))}
    </div>
  );
}

/**
 * Outpaint while it runs: the original on its padded canvas, with ONE light sweep across the whole canvas that is cut out
 * wherever the photo sits, so the glow reads as a single band passing over the new area and nothing sweeps over the photo.
 */
function PaddedPreview({ job, before, w, h }: { job: Job; before: string; w: number; h: number }) {
  const p = job.params;
  const x1 = ((p.pad_left ?? 0) / w) * 100;
  const x2 = 100 - ((p.pad_right ?? 0) / w) * 100;
  const y1 = ((p.pad_top ?? 0) / h) * 100;
  const y2 = 100 - ((p.pad_bottom ?? 0) / h) * 100;
  // Even-odd: the outer frame minus the photo's rectangle.
  const clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}% ${y1}%, ${x1}% ${y2}%, ${x2}% ${y2}%, ${x2}% ${y1}%, ${x1}% ${y1}%)`;
  return (
    <>
      <img src={before} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
      <div className="shimmer shimmer-pad absolute inset-0 overflow-hidden" style={{ clipPath }} aria-hidden />
    </>
  );
}

/** Inpaint while it runs: the original with a light sweep over the painted area only, whatever its shape (CSS mask). */
function MaskedPreview({ before, mask }: { before: string; mask: string }) {
  const m = { WebkitMaskImage: `url(${mask})`, maskImage: `url(${mask})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" } as const;
  return (
    <>
      <img src={before} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
      <div className="shimmer shimmer-pad absolute inset-0 overflow-hidden bg-[rgba(246,205,124,0.2)]" style={m} aria-hidden />
    </>
  );
}

/** Where the result will land: live preview, step X/Y, pass, ETA and queue position, with Cancel in place. */
export function RunningCard({ job, compact }: { job: Job; compact?: boolean }) {
  const preview = useJobs((s) => s.preview);
  const eta = useEta(job);
  const { w, h } = jobSize(job);
  const { step, max, queue_ahead: ahead } = job.live;
  const queued = job.status === "queued" || (job.live.node === undefined && !max);
  const pass = passOf(job);
  const decoding = useDecodePhase(job);
  const enhancing = isEnhancing(job);
  const cancelling = useJobs((s) => !!s.cancelling[job.id]);
  const before = useBeforeUrl(job);
  const padded = job.mode === "outpaint" && !!before;
  const maskUrl = useMaskPreviewUrl(job);
  const masked = job.mode === "inpaint" && !!before && !!maskUrl;
  const staged = padded || masked; // the card shows the photo itself instead of the blurred live preview
  const pct = max ? Math.min(100, ((step ?? 0) / max) * 100) : 0;
  const waiting = ahead ? `${ahead} job${ahead === 1 ? "" : "s"} ahead in the queue` : null;

  return (
    <Box w={w} h={h} className={`${staged || decoding || cancelling || enhancing ? "" : "shimmer"} overflow-hidden rounded-m border border-line bg-raised`}>
      {padded ? (
        <PaddedPreview job={job} before={before!} w={w} h={h} />
      ) : masked ? (
        <MaskedPreview before={before!} mask={maskUrl!} />
      ) : preview && job.status === "running" ? (
        <img src={preview} alt="" className={`absolute inset-0 h-full w-full scale-110 object-cover opacity-90 saturate-125 transition-[filter] duration-700 ${decoding ? "blur-[5px]" : "blur-[14px]"}`} />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-text-3">
          <Ring className={`h-14 w-14 motion-reduce:animate-none ${cancelling ? "animate-spin [animation-duration:1.4s]" : "animate-pulse"}`} />
        </div>
      )}
      {cancelling ? <div className="absolute inset-0 z-[1] bg-black/35 fade-in" aria-hidden /> : staged ? null : decoding ? <Ripples /> : <Bubbles />}
      <div className="absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-[rgba(8,7,12,0.9)] to-transparent p-3.5 pt-10 text-[#f1eadb]">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px] font-medium">
          <span>{cancelling ? "Cancelling…" : enhancing ? "Improving your prompt…" : decoding ? "Developing the image…" : queued ? "Waiting for the GPU…" : "Summoning…"}</span>
          {cancelling ? (
            <span className="font-mono text-gold-hi">stopping</span>
          ) : enhancing ? (
            <span className="font-mono text-gold-hi">writing</span>
          ) : decoding ? (
            <span className="font-mono text-gold-hi">decoding</span>
          ) : max ? (
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
          aria-valuenow={decoding || cancelling || enhancing ? undefined : Math.round(pct)}
          className="h-[3px] overflow-hidden rounded-full bg-white/20"
        >
          {cancelling ? (
            <div className="breathe h-full w-full animate-[breathe_0.9s_ease-in-out_infinite] rounded-full bg-text-2" />
          ) : decoding || enhancing ? (
            <div className="breathe h-full w-full animate-[breathe_1.6s_ease-in-out_infinite] rounded-full bg-gold" />
          ) : (
            <div className="h-full rounded-full bg-gold transition-[width] duration-200" style={{ width: `${pct}%` }} />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-[#b9b2a3]">
          <span>
            {cancelling
              ? "Waiting for the backend to reach a stopping point…"
              : enhancing
                ? "The enhancer rewrites your instruction first; the image comes next."
                : [!decoding && eta !== null && !compact ? `${formatEta(eta)} left in this pass` : null, waiting].filter(Boolean).join(" · ") ||
                (queued ? "Starting…" : "Working…")}
          </span>
          <button
            type="button"
            onClick={() => void requestCancel(job.id)}
            disabled={cancelling}
            className="-my-3 flex h-11 items-center gap-1 rounded-full px-2.5 text-[12px] text-[#f1eadb] disabled:opacity-70"
          >
            {cancelling ? <Loader2 size={14} strokeWidth={1.7} className="animate-spin motion-reduce:animate-none" /> : <X size={14} strokeWidth={1.7} />}
            {cancelling ? "Stopping" : "Cancel"}
          </button>
        </div>
      </div>
    </Box>
  );
}
