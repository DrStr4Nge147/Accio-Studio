import { useEffect, useState } from "react";
import { Copy, Download, Info, RotateCcw, Share2 } from "lucide-react";
import { imageUrl } from "../../api/http";
import type { Job } from "../../api/types";
import { reuseSettings } from "../../features/create/actions";
import { formatDuration, jobSize } from "../../lib/jobView";
import { canShareFiles, shareImage } from "../../lib/share";
import { useJobs } from "../../store/jobs";
import { IconButton } from "../ui/controls";
import { Box } from "./Box";
import { Zoomable } from "./Zoomable";

const glass = "bg-[rgba(10,9,14,0.62)] text-[#f1eadb] border border-white/10 backdrop-blur-md";

/** A finished job: the image, a strip to switch between outputs (batch / first pass), actions and details. */
export function ResultView({ job }: { job: Job }) {
  const [index, setIndex] = useState(0);
  const [details, setDetails] = useState(false);
  const [full, setFull] = useState(false);
  const revealing = useJobs((s) => !!s.reveal[job.id]);
  const clearReveal = useJobs((s) => s.clearReveal);
  const { w, h } = jobSize(job);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  // Final images first, then the first-pass image(s); each keeps its index into job.outputs for the URL.
  const items = job.outputs
    .map((o, i) => ({ o, i }))
    .sort((a, b) => Number(a.o.role !== "final") - Number(b.o.role !== "final") || a.i - b.i);
  const cur = items[Math.min(index, items.length - 1)];
  if (!cur) return <div className="grid h-full place-items-center text-text-2">This job produced no images.</div>;

  const url = imageUrl(job.id, cur.i);
  const seed = job.seeds.main ?? job.seeds.pass1 ?? "image";
  const filename = `accio-${seed}-${cur.i + 1}.png`;
  const firstPass = cur.o.role === "first_pass";

  const picture = (
    <img
      src={url}
      alt={job.params.prompt ?? "Generated image"}
      width={w}
      height={h}
      decoding="async"
      draggable={false}
      className={`h-full w-full object-contain ${revealing && !firstPass ? "reveal-img" : ""}`}
      onAnimationEnd={() => clearReveal(job.id)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {full && (
        <div role="dialog" aria-modal="true" aria-label="Image viewer" className="fade-in fixed inset-0 z-50 bg-black/95">
          <Zoomable onClose={() => setFull(false)}>
            <img src={url} alt={job.params.prompt ?? "Generated image"} draggable={false} className="h-full w-full object-contain" />
          </Zoomable>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Box w={w} h={h} className={`${revealing && !firstPass ? "reveal-glow" : ""} overflow-hidden rounded-m border border-line bg-raised`}>
          <Zoomable key={url} onExpand={() => setFull(true)}>
            {picture}
          </Zoomable>
          {firstPass && <span className={`${glass} absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-medium`}>First pass</span>}
          <div className="absolute right-2 top-2 flex flex-col gap-2">
            <a href={url} download={filename} aria-label="Download" data-tip="Download" className={`${glass} grid h-11 w-11 place-items-center rounded-full`}>
              <Download size={20} strokeWidth={1.7} />
            </a>
            {canShareFiles() && (
              <IconButton label="Share" className={glass} onClick={() => void shareImage(url, filename).catch(() => undefined)}>
                <Share2 size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
              </IconButton>
            )}
            <IconButton label="Reuse settings" className={glass} onClick={() => reuseSettings(job)}>
              <RotateCcw size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
            </IconButton>
            <IconButton label="Details" className={glass} aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              <Info size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
            </IconButton>
          </div>
          {details && <Details job={job} />}
        </Box>
      </div>
      {items.length > 1 && (
        <div className="flex flex-none gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="Outputs">
          {items.map((it, n) => (
            <button
              key={it.i}
              type="button"
              role="tab"
              aria-selected={n === index}
              aria-label={it.o.role === "final" ? `Image ${n + 1}` : "First pass image"}
              onClick={() => setIndex(n)}
              className={`relative h-14 w-14 flex-none overflow-hidden rounded-s border ${n === index ? "border-gold" : "border-line-strong"}`}
            >
              <img src={imageUrl(job.id, it.i)} alt="" loading="lazy" className="h-full w-full object-cover" />
              {it.o.role !== "final" && <span className="absolute inset-x-0 bottom-0 bg-black/60 text-[9px] text-white">1st pass</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Details({ job }: { job: Job }) {
  const seeds = Object.entries(job.seeds);
  const { w, h } = jobSize(job);
  return (
    <div className="absolute inset-x-0 bottom-0 z-[4] max-h-[70%] overflow-y-auto bg-[rgba(10,9,14,0.88)] p-3.5 text-[12px] leading-snug text-[#f1eadb] backdrop-blur-md">
      <div className="font-medium">
        {job.label} · {w}×{h}
        {job.params.batch > 1 && ` · ${job.params.batch} images`}
      </div>
      {job.finished_at && (
        <div className="mt-1 text-[#b9b2a3]" data-tip="From pressing Generate to the finished image, including any wait in the queue">
          Time taken {formatDuration(job.finished_at - job.created_at)}
        </div>
      )}
      <p className="mt-1.5 text-[#b9b2a3]">{job.params.prompt}</p>
      <div className="mt-2 font-mono text-[11px] text-gold-hi">
        {seeds.map(([k, v]) => (
          <div key={k}>
            {k} {v}
          </div>
        ))}
      </div>
      {job.warnings.map((m) => (
        <p key={m} className="mt-1.5 text-[#b9b2a3]">
          Note: {m}
        </p>
      ))}
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(seeds.map(([k, v]) => `${k}: ${v}`).join("\n")).catch(() => undefined)}
        className="mt-2 flex h-11 items-center gap-1.5 text-[12px] text-gold-hi"
      >
        <Copy size={14} strokeWidth={1.7} /> Copy seeds
      </button>
    </div>
  );
}
