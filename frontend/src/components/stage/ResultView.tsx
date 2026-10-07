import { useEffect, useRef, useState } from "react";
import { Columns2, Copy, Download, Info, Repeat, RotateCcw, Share2, TextQuote, WandSparkles, X } from "lucide-react";
import { imageUrl } from "../../api/http";
import type { Job } from "../../api/types";
import { continueFromResult, sendToEdit } from "../../features/edit/actions";
import { useEdit, type EditMode } from "../../features/edit/store";
import { useBeforeUrl } from "../../features/edit/useBefore";
import { reuseAny } from "../../features/reuse";
import { formatDuration, jobSize } from "../../lib/jobView";
import { canShareFiles, shareImage } from "../../lib/share";
import { useJobs } from "../../store/jobs";
import { IconButton } from "../ui/controls";
import { Box } from "./Box";
import { Compare } from "./Compare";
import { Zoomable } from "./Zoomable";

const glass = "bg-[rgba(10,9,14,0.62)] text-[#f1eadb] border border-white/10 backdrop-blur-md";

const SEND_TARGETS: { mode: EditMode; label: string }[] = [
  { mode: "multiedit", label: "Multi-edit" },
  { mode: "inpaint", label: "Inpaint" },
  { mode: "outpaint", label: "Outpaint" },
];

/** A finished job: the image, a strip to switch between outputs (batch / first pass), actions and details. */
export function ResultView({ job }: { job: Job }) {
  const [index, setIndex] = useState(0);
  const [details, setDetails] = useState(false);
  const [full, setFull] = useState(false);
  const [compare, setCompare] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ url: string; w: number; h: number } | null>(null);
  const revealing = useJobs((s) => !!s.reveal[job.id]);
  const clearReveal = useJobs((s) => s.clearReveal);
  const before = useBeforeUrl(job);
  const hint = jobSize(job);

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
  // The real pixel size wins once the image has loaded; until then the request's size keeps the layout from jumping.
  const { w, h } = natural?.url === url ? natural : hint;
  const seed = job.seeds.main ?? job.seeds.pass1 ?? "image";
  const filename = `accio-${seed}-${cur.i + 1}.png`;
  const firstPass = cur.o.role === "first_pass";
  const canCompare = !!before && !firstPass;

  const picture = (
    <img
      src={url}
      alt={job.params.prompt ?? "Generated image"}
      width={w}
      height={h}
      decoding="async"
      draggable={false}
      className={`h-full w-full object-contain ${revealing && !firstPass ? "reveal-img" : ""}`}
      onLoad={(e) => setNatural({ url, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
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
          {compare && canCompare ? (
            <Compare before={before!} after={url} />
          ) : (
            <Zoomable key={url} onExpand={() => setFull(true)}>
              {picture}
            </Zoomable>
          )}
          {firstPass && <span className={`${glass} absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-medium`}>First pass</span>}
          <div className="absolute right-2 top-2 z-[3] flex flex-col gap-2">
            <a href={url} download={filename} aria-label="Download" data-tip="Download" className={`${glass} hover-wash grid h-11 w-11 place-items-center rounded-full`}>
              <Download size={20} strokeWidth={1.7} />
            </a>
            {canShareFiles() && (
              <IconButton label="Share" className={glass} onClick={() => void shareImage(url, filename).catch(() => undefined)}>
                <Share2 size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
              </IconButton>
            )}
            {job.mode !== "create" && !firstPass && (
              <IconButton label="Edit this result" className={glass} onClick={() => void continueFromResult(job, cur.i).then(setSendError)}>
                <Repeat size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
              </IconButton>
            )}
            <IconButton label="Send to Edit" className={glass} aria-expanded={sendOpen} onClick={() => setSendOpen((o) => !o)}>
              <WandSparkles size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
            </IconButton>
            {canCompare && (
              <IconButton label={compare ? "Hide before / after" : "Compare with the original"} className={glass} aria-pressed={compare} onClick={() => setCompare((c) => !c)}>
                <Columns2 size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
              </IconButton>
            )}
            <IconButton label="Reuse settings" className={glass} onClick={() => reuseAny(job)}>
              <RotateCcw size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
            </IconButton>
            <IconButton label="Details" className={glass} aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              <Info size={20} strokeWidth={1.7} className="text-[#f1eadb]" />
            </IconButton>
          </div>
          {sendOpen && (
            <div role="menu" aria-label="Send to Edit" className={`${glass} absolute right-16 top-2 z-[4] w-44 rounded-m p-1`}>
              <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-[#b9b2a3]">Send to Edit</p>
              {SEND_TARGETS.map((t) => (
                <button
                  key={t.mode}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSendOpen(false);
                    void sendToEdit(job, cur.i, t.mode).then(setSendError);
                  }}
                  className="hover-wash flex h-11 w-full items-center rounded-lg px-3 text-left text-[14px]"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {sendError && (
            <p role="alert" className="absolute inset-x-3 top-3 z-[5] mx-auto w-fit max-w-[80%] rounded-full bg-[rgba(10,9,14,0.88)] px-3.5 py-2 text-[13px] text-danger">
              {sendError}
              <button type="button" aria-label="Dismiss" onClick={() => setSendError(null)} className="ml-2 align-middle">
                <X size={14} strokeWidth={1.7} className="inline" />
              </button>
            </p>
          )}
          {job.prompt_used && <PromptUsed job={job} />}
          {details && <Details job={job} w={w} h={h} />}
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
              className={`relative h-14 w-14 flex-none overflow-hidden rounded-s border ${n === index ? "border-gold" : "border-line-strong hover:border-text-3"}`}
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

/** What the prompt enhancer actually sent to the model, with "use as prompt" (APP_SPEC 6.3). */
function PromptUsed({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  const text = job.prompt_used ?? "";
  const mode = job.mode as EditMode;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-tip="See the prompt the enhancer wrote" className={`${glass} hover-wash absolute bottom-2.5 right-2.5 z-[3] flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px]`}>
        <TextQuote size={16} strokeWidth={1.7} /> Prompt used
      </button>
    );
  }
  return (
    <div className="absolute inset-x-0 bottom-0 z-[4] max-h-[60%] overflow-y-auto bg-[rgba(10,9,14,0.9)] p-3.5 text-[13px] leading-snug text-[#f1eadb] backdrop-blur-md" role="region" aria-label="Prompt used">
      <div className="flex items-center justify-between">
        <span className="font-medium">Prompt used</span>
        <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="hover-wash -mr-2 grid h-11 w-11 place-items-center rounded-full">
          <X size={18} strokeWidth={1.7} />
        </button>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[#b9b2a3]">{text}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => {
            useEdit.getState().setPrompt(mode, text);
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1800);
          }}
          className="hover-wash flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] text-gold-hi"
        >
          <WandSparkles size={14} strokeWidth={1.7} /> {copied ? "Set as your prompt" : "Use as prompt"}
        </button>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(text).catch(() => undefined)} className="hover-wash flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] text-gold-hi">
          <Copy size={14} strokeWidth={1.7} /> Copy
        </button>
      </div>
    </div>
  );
}

function Details({ job, w, h }: { job: Job; w: number; h: number }) {
  const seeds = Object.entries(job.seeds);
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
        className="hover-wash -ml-2 mt-2 flex h-11 items-center gap-1.5 rounded-full px-2 text-[12px] text-gold-hi"
      >
        <Copy size={14} strokeWidth={1.7} /> Copy seeds
      </button>
    </div>
  );
}
