import { useEffect, useMemo, useRef, useState } from "react";
import { Columns2, Copy, Download, Info, Maximize2, Repeat, RotateCcw, Share2, SquareDashed, TextQuote, WandSparkles, X } from "lucide-react";
import { imageUrl } from "../../api/http";
import type { Job } from "../../api/types";
import { continueFromResult, sendToEdit } from "../../features/edit/actions";
import { showEnhanced } from "../../features/edit/enhanced";
import type { EditMode } from "../../features/edit/store";
import { useBeforeUrl, useMaskPreviewUrl } from "../../features/edit/useBefore";
import { parseCaption } from "../../features/create/builder/ideogram";
import { loadStyles, splitEditStyle, splitStyle } from "../../features/create/styles";
import { reuseAny } from "../../features/reuse";
import { enhancedText, formatDuration, jobSize } from "../../lib/jobView";
import { canShareFiles, shareImage } from "../../lib/share";
import { useJobs } from "../../store/jobs";
import { openContextMenu } from "../ui/ContextMenu";
import { IconButton } from "../ui/controls";
import { jobMenuItems, removeJob } from "../../features/history/jobMenu";
import { Box } from "./Box";
import { Compare } from "./Compare";
import { LayoutOverlay } from "./LayoutOverlay";
import { LocalReveal } from "./LocalReveal";
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
  const [boxes, setBoxes] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ url: string; w: number; h: number } | null>(null);
  const revealing = useJobs((s) => !!s.reveal[job.id]);
  const clearReveal = useJobs((s) => s.clearReveal);
  const before = useBeforeUrl(job);
  const maskUrl = useMaskPreviewUrl(job);
  const local = job.mode === "inpaint"; // inpaint reveals only the painted area; everything else gets the whole-image reveal
  const hint = jobSize(job);
  const layout = useMemo(() => (job.mode === "create" ? parseCaption(job.params.prompt ?? "") : null), [job.mode, job.params.prompt]);

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
  if (!cur) {
    return (
      <div className="grid h-full place-items-center text-text-2">
        <div className="flex flex-col items-center gap-3">
          <p>This job produced no images.</p>
          <button type="button" onClick={() => void removeJob(job)} className="hover-wash rounded-m border border-line px-3 py-2 text-[13px] text-text-2 hover:text-text">
            Remove from history
          </button>
        </div>
      </div>
    );
  }

  const url = imageUrl(job.id, cur.i);
  // The real pixel size wins once the image has loaded; until then the request's size keeps the layout from jumping.
  const { w, h } = natural?.url === url ? natural : hint;
  const seed = job.seeds.main ?? job.seeds.pass1 ?? "image";
  const filename = `accio-${seed}-${cur.i + 1}.png`;
  const firstPass = cur.o.role === "first_pass";
  const canCompare = !!before && !firstPass;

  const showReveal = revealing && !firstPass;
  const localReady = showReveal && local && !!before && !!maskUrl;
  const onLoad = (el: HTMLImageElement) => setNatural({ url, w: el.naturalWidth, h: el.naturalHeight });
  const alt = job.params.prompt ?? "Generated image";

  const picture = localReady ? (
    <LocalReveal url={url} before={before!} mask={maskUrl!} w={w} h={h} alt={alt} onLoad={onLoad} onDone={() => clearReveal(job.id)} />
  ) : (
    <img
      src={url}
      alt={job.params.prompt ?? "Generated image"}
      width={w}
      height={h}
      decoding="async"
      draggable={false}
      className={`h-full w-full object-contain ${showReveal ? (local ? "fade-in" : "reveal-img") : ""}`}
      onLoad={(e) => onLoad(e.currentTarget)}
      onAnimationEnd={() => clearReveal(job.id)}
    />
  );

  // One set of actions, two placements: a column over the image on desktop, a bar under it on phones (a column of
  // 44 px buttons does not fit beside a short image and was clipped).
  const actions = (bar: boolean) => {
    const cls = bar ? "!h-11 !w-auto min-w-0 max-w-12 flex-1 border-0 bg-transparent text-text-2" : glass;
    const ic = bar ? "" : "text-[#f1eadb]";
    return (
      <>
        <a href={url} download={filename} aria-label="Download" data-tip="Download" className={`${bar ? cls : glass} hover-wash grid h-11 w-11 place-items-center rounded-full`}>
          <Download size={20} strokeWidth={1.7} />
        </a>
        {canShareFiles() && (
          <IconButton label="Share" className={cls} onClick={() => void shareImage(url, filename).catch(() => undefined)}>
            <Share2 size={20} strokeWidth={1.7} className={ic} />
          </IconButton>
        )}
        {job.mode !== "create" && job.mode !== "charsheet" && !firstPass && (
          <IconButton label="Edit this result" className={cls} onClick={() => void continueFromResult(job, cur.i).then(setSendError)}>
            <Repeat size={20} strokeWidth={1.7} className={ic} />
          </IconButton>
        )}
        <IconButton label="Send to Edit" className={cls} aria-expanded={sendOpen} onClick={() => { setPromptOpen(false); setDetails(false); setSendOpen((o) => !o); }}>
          <WandSparkles size={20} strokeWidth={1.7} className={ic} />
        </IconButton>
        {canCompare && (
          <IconButton label={compare ? "Hide before / after" : "Compare with the original"} className={cls} aria-pressed={compare} onClick={() => setCompare((c) => !c)}>
            <Columns2 size={20} strokeWidth={1.7} className={ic} />
          </IconButton>
        )}
        {layout && !firstPass && (
          <IconButton label={boxes ? "Hide the layout boxes" : "Show the layout boxes"} className={cls} aria-pressed={boxes} onClick={() => setBoxes((b) => !b)}>
            <SquareDashed size={20} strokeWidth={1.7} className={`${ic} ${boxes ? "text-gold-hi" : ""}`} />
          </IconButton>
        )}
        <IconButton label="Reuse settings" className={cls} onClick={() => reuseAny(job)}>
          <RotateCcw size={20} strokeWidth={1.7} className={ic} />
        </IconButton>
        {bar && enhancedText(job) && (
          <IconButton label="Prompt used" className={cls} aria-expanded={promptOpen} onClick={() => { setSendOpen(false); setDetails(false); setPromptOpen((o) => !o); }}>
            <TextQuote size={20} strokeWidth={1.7} />
          </IconButton>
        )}
        <IconButton label="Details" className={cls} aria-expanded={details} onClick={() => { setSendOpen(false); setPromptOpen(false); setDetails((d) => !d); }}>
          <Info size={20} strokeWidth={1.7} className={ic} />
        </IconButton>
      </>
    );
  };

  const sendMenu = (place: string) => (
    <div role="menu" aria-label="Send to Edit" className={`${glass} z-[4] rounded-m p-1 ${place}`}>
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
        <Box w={w} h={h} className={`${showReveal && !local ? "reveal-glow" : ""} overflow-hidden rounded-m border border-line bg-raised`}>
          {compare && canCompare ? (
            <Compare before={before!} after={url} />
          ) : (
            <div className="contents" onContextMenu={(e) => openContextMenu(e, [{ label: "Full screen", icon: <Maximize2 size={16} strokeWidth={1.7} />, onSelect: () => setFull(true) }, ...jobMenuItems(job, cur.i).filter((i) => i.label !== "Open")])}>
              <Zoomable key={url} onExpand={() => setFull(true)}>
                <div className="relative h-full w-full">
                  {picture}
                  {boxes && layout && !firstPass && <LayoutOverlay regions={layout.regions} />}
                </div>
              </Zoomable>
            </div>
          )}
          {firstPass && <span className={`${glass} absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-medium`}>First pass</span>}
          <div className="absolute right-2 top-2 z-[3] hidden flex-col gap-2 lg:flex">{actions(false)}</div>
          {sendOpen && sendMenu("absolute right-16 top-2 hidden w-44 lg:block")}
          {sendError && (
            <p role="alert" className="absolute inset-x-3 top-3 z-[5] mx-auto w-fit max-w-[80%] rounded-full bg-[rgba(10,9,14,0.88)] px-3.5 py-2 text-[13px] text-danger">
              {sendError}
              <button type="button" aria-label="Dismiss" onClick={() => setSendError(null)} className="ml-2 align-middle">
                <X size={14} strokeWidth={1.7} className="inline" />
              </button>
            </p>
          )}
          {enhancedText(job) && <PromptUsed job={job} open={promptOpen} onOpen={setPromptOpen} />}
          {details && <Details job={job} w={w} h={h} />}
        </Box>
      </div>
      <div className="relative flex-none lg:hidden">
        {sendOpen && sendMenu("absolute bottom-full right-0 mb-2 w-44")}
        {enhancedText(job) && <PromptUsed job={job} open={promptOpen} onOpen={setPromptOpen} bar />}
        {details && <Details job={job} w={w} h={h} bar />}
        <div className="flex items-center justify-between rounded-full border border-line bg-surface px-4" role="toolbar" aria-label="Result actions">
          {actions(true)}
        </div>
      </div>
      {items.length > 1 && (
        <div className="flex flex-none gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="Outputs">
          {items.map((it, n) => (
            <button
              key={it.i}
              type="button"
              role="tab"
              aria-selected={n === index}
              aria-label={it.o.label ?? (it.o.role === "final" ? `Image ${n + 1}` : "First pass image")}
              onClick={() => setIndex(n)}
              className={`relative h-14 w-14 flex-none overflow-hidden rounded-s border ${n === index ? "border-gold" : "border-line-strong hover:border-text-3"}`}
            >
              <img src={imageUrl(job.id, it.i, 384)} alt="" loading="lazy" className="h-full w-full object-cover" />
              {it.o.role !== "final" && <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-0.5 text-[9px] text-white">{it.o.role === "part" ? (it.o.label ?? "View") : "1st pass"}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the prompt enhancer actually sent to the model, with "use as prompt" (APP_SPEC 6.3). */
/** `bar`: the phone placement, a wide popover above the toolbar; otherwise a panel inside the picture (desktop only). */
export function PromptUsed({ job, open, onOpen: setOpen, bar, always }: { job: Job; open: boolean; onOpen: (v: boolean) => void; bar?: boolean; always?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  const text = enhancedText(job) ?? "";
  const mode = job.mode as EditMode;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!open) {
    if (bar) return null;
    return (
      <button type="button" onClick={() => setOpen(true)} data-tip="See the prompt the enhancer wrote" className={`${glass} hover-wash absolute bottom-2.5 right-2.5 z-[3] hidden h-11 items-center lg:flex gap-1.5 rounded-full px-3.5 text-[13px]`}>
        <TextQuote size={16} strokeWidth={1.7} /> Prompt used
      </button>
    );
  }
  return (
    <div className={`${bar ? `absolute inset-x-0 bottom-full z-[4] mb-2 max-h-[45vh] rounded-m border border-white/10 bg-[rgba(10,9,14,0.96)] ${always ? "" : "lg:hidden"}` : "absolute inset-x-0 bottom-0 z-[4] hidden max-h-[60%] bg-[rgba(10,9,14,0.9)] lg:block"} overflow-y-auto p-3.5 text-[13px] leading-snug text-[#f1eadb] backdrop-blur-md`} role="region" aria-label="Prompt used">
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
            if (mode === "multiedit" || mode === "inpaint") showEnhanced(mode, { id: job.id, text });
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1800);
          }}
          className="hover-wash flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] text-gold-hi"
        >
          <WandSparkles size={14} strokeWidth={1.7} /> {copied ? "Now in the prompt box" : "Use as prompt"}
        </button>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(text).catch(() => undefined)} className="hover-wash flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] text-gold-hi">
          <Copy size={14} strokeWidth={1.7} /> Copy
        </button>
      </div>
    </div>
  );
}

export function Details({ job, w, h, bar, always }: { job: Job; w: number; h: number; bar?: boolean; always?: boolean }) {
  const seeds = Object.entries(job.seeds);
  const [styleName, setStyleName] = useState<string>();
  useEffect(() => {
    let live = true;
    const prompt: string = job.params.prompt ?? ""; // some Edit modes (the character sheet) have none
    const split = job.mode === "multiedit" ? splitEditStyle : splitStyle; // Multi-edit carries the style as an instruction
    void loadStyles().then((styles) => live && setStyleName(prompt ? split(prompt, styles).style?.name : undefined));
    return () => {
      live = false;
    };
  }, [job.params.prompt]);
  return (
    <div className={`${bar ? `absolute inset-x-0 bottom-full z-[4] mb-2 max-h-[45vh] rounded-m border border-white/10 bg-[rgba(10,9,14,0.96)] ${always ? "" : "lg:hidden"}` : "absolute inset-x-0 bottom-0 z-[4] hidden max-h-[70%] bg-[rgba(10,9,14,0.88)] lg:block"} overflow-y-auto p-3.5 text-[12px] leading-snug text-[#f1eadb] backdrop-blur-md`}>
      <div className="font-medium">
        {job.label} · {w}×{h}
        {job.params.batch > 1 && ` · ${job.params.batch} images`}
      </div>
      {job.finished_at && (
        <div className="mt-1 text-[#b9b2a3]" data-tip="From pressing Generate to the finished image, including any wait in the queue">
          Time taken {formatDuration(job.finished_at - job.created_at)}
        </div>
      )}
      {styleName && (
        <div className="mt-1 text-[#b9b2a3]" data-tip="A prompt style was added to your prompt">
          Style {styleName}
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
