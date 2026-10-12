import { ChevronLeft, ChevronRight, Columns2, Download, Info, Loader2, Repeat, RotateCcw, Share2, TextQuote, Trash2, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { imageUrl } from "../../api/http";
import type { Job } from "../../api/types";
import { Compare } from "../../components/stage/Compare";
import { Details, PromptUsed } from "../../components/stage/ResultView";
import { Zoomable, type ViewInfo } from "../../components/stage/Zoomable";
import { enhancedText, jobSize, shortLabel } from "../../lib/jobView";
import { canShareFiles, shareImage } from "../../lib/share";
import { afterRemoval, dragOutcome, GAP_PX, isDragStart, isTap, neighborId, resist } from "../../lib/swipe";
import { useServer } from "../../store/health";
import { continueFromResult, sendToEdit } from "../edit/actions";
import type { EditMode } from "../edit/store";
import { useBeforeUrl } from "../edit/useBefore";
import { removeJob } from "../history/jobMenu";
import { reuseAny } from "../reuse";

const glass = "bg-[rgba(10,9,14,0.62)] text-[#f1eadb] border border-white/10 backdrop-blur-md";
const SEND_TARGETS: { mode: EditMode; label: string }[] = [
  { mode: "multiedit", label: "Multi-edit" },
  { mode: "inpaint", label: "Inpaint" },
  { mode: "outpaint", label: "Outpaint" },
];

/** Chrome (bars, buttons) stays up. A tap on the picture hides it for an unobstructed view and the next tap brings it back; `locked` (a panel or compare is open) keeps it up. */
function useChrome(locked: boolean) {
  const [hidden, setHidden] = useState(false);
  const visible = !hidden || locked;
  const poke = useCallback(() => setHidden(false), []);
  const toggle = useCallback(() => setHidden((h) => !h && !locked), [locked]);
  return { visible, poke, toggle };
}

type Panel = "details" | "prompt" | "send" | "delete" | null;

/** One image with its action bar and panels. Keyed by job, so its state (output, compare, panel) resets on every swipe. */
function ViewerFrame({
  job,
  chrome,
  onLock,
  onZoom,
  onLeave,
  stageRef,
}: {
  job: Job;
  /** the picture layer: the carousel moves it with the finger */
  stageRef: RefObject<HTMLDivElement | null>;
  chrome: boolean;
  onLock: (locked: boolean) => void;
  onZoom: (zoomed: boolean) => void;
  onLeave: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [compare, setCompare] = useState(false);
  const [outIndex, setOutIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canDelete = useServer((s) => s.health?.can_delete_files === true);
  const before = useBeforeUrl(job);

  useEffect(() => onLock(panel !== null || compare), [panel, compare, onLock]);

  // Final images first, then first-pass images; each keeps its index into job.outputs for the URL.
  const outs = job.outputs
    .map((o, i) => ({ o, i }))
    .sort((a, b) => Number(a.o.role !== "final") - Number(b.o.role !== "final") || a.i - b.i);
  const cur = outs[Math.min(outIndex, outs.length - 1)];
  if (!cur) return null;
  const url = imageUrl(job.id, cur.i);
  const seed = job.seeds.main ?? job.seeds.pass1 ?? "image";
  const filename = `accio-${seed}-${cur.i + 1}.png`;
  const firstPass = cur.o.role === "first_pass";
  const canCompare = !!before && !firstPass;
  const { w, h } = jobSize(job);
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const btn = "hover-wash grid h-11 w-11 flex-none place-items-center rounded-full";
  const alt = String(job.params.prompt ?? "Generated image");

  const doSend = async (mode: EditMode) => {
    const err = await sendToEdit(job, cur.i, mode);
    if (err) setNotice(err);
    else onLeave(); // the Edit tab is now showing: the gallery (and this viewer) unmounts, history is tidied by onLeave
  };

  return (
    <>
      <div ref={stageRef} className="absolute inset-0 will-change-transform">
        {compare && canCompare ? (
          <Compare before={before!} after={url} />
        ) : (
          <Zoomable key={url} hideControls onView={(v: ViewInfo) => onZoom(v.k > 1.01)}>
            <img src={url} alt={alt} width={w} height={h} decoding="async" draggable={false} className="h-full w-full object-contain" />
          </Zoomable>
        )}
      </div>

      {outs.length > 1 && (
        <div data-no-swipe className={`absolute left-1/2 top-16 z-[5] flex -translate-x-1/2 gap-1.5 transition-opacity duration-200 ${chrome ? "opacity-100" : "pointer-events-none opacity-0"}`} role="tablist" aria-label="Outputs">
          {outs.map((it, n) => (
            <button
              key={it.i}
              type="button"
              role="tab"
              aria-selected={n === outIndex}
              onClick={() => setOutIndex(n)}
              className={`${glass} h-9 rounded-full px-3.5 text-[12px] ${n === outIndex ? "!border-gold !text-gold-hi" : ""}`}
            >
              {it.o.label ?? (it.o.role === "final" ? `Image ${n + 1}` : "First pass")}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p role="alert" data-no-swipe className="absolute inset-x-3 top-16 z-[6] mx-auto w-fit max-w-[85%] rounded-full bg-[rgba(10,9,14,0.9)] px-3.5 py-2 text-[13px] text-danger">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="ml-2 align-middle">
            <X size={14} strokeWidth={1.7} className="inline" />
          </button>
        </p>
      )}

      <div
        data-no-swipe
        className={`safe-b absolute inset-x-0 bottom-0 z-[5] flex justify-center px-3 pb-3 transition-opacity duration-200 ${chrome ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div className="relative w-full max-w-xl">
          {panel === "send" && (
            <div role="menu" aria-label="Send to Edit" className={`${glass} absolute bottom-full right-0 z-[4] mb-2 w-44 rounded-m p-1`}>
              <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-[#b9b2a3]">Send to Edit</p>
              {SEND_TARGETS.map((t) => (
                <button key={t.mode} type="button" role="menuitem" onClick={() => void doSend(t.mode)} className="hover-wash flex h-11 w-full items-center rounded-lg px-3 text-left text-[14px]">
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {panel === "prompt" && <PromptUsed job={job} open onOpen={(o) => !o && setPanel(null)} bar always />}
          {panel === "details" && <Details job={job} w={w} h={h} bar always />}
          {panel === "delete" && (
            <div role="alertdialog" aria-label="Delete this image" className="absolute inset-x-0 bottom-full z-[4] mb-2 rounded-m border border-white/10 bg-[rgba(10,9,14,0.96)] p-3.5 text-[13px] text-[#f1eadb] backdrop-blur-md">
              <p>{canDelete ? "Permanently delete this image from your computer and the gallery? It can't be undone." : "Remove this image from Accio's history? The file stays where the backend saved it."}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setPanel(null)} className="hover-wash h-11 flex-1 rounded-full border border-white/20 text-[14px]">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void removeJob(job).finally(() => setBusy(false)); // the job leaves the store; the viewer moves on by itself
                  }}
                  className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-danger text-[14px] font-semibold text-bg disabled:opacity-60"
                >
                  {busy && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />}
                  {canDelete ? "Delete" : "Remove"}
                </button>
              </div>
            </div>
          )}

          <div className={`${glass} flex items-center justify-between gap-0.5 overflow-x-auto rounded-full px-2 no-scrollbar`} role="toolbar" aria-label="Image actions">
            <a href={url} download={filename} aria-label="Download" data-tip="Download" className={btn}>
              <Download size={20} strokeWidth={1.7} />
            </a>
            {canShareFiles() && (
              <button type="button" aria-label="Share" data-tip="Share" className={btn} onClick={() => void shareImage(url, filename).catch(() => undefined)}>
                <Share2 size={20} strokeWidth={1.7} />
              </button>
            )}
            {job.mode !== "create" && job.mode !== "charsheet" && !firstPass && (
              <button type="button" aria-label="Edit this result" data-tip="Edit this result" className={btn} onClick={() => void continueFromResult(job, cur.i).then((err) => (err ? setNotice(err) : onLeave()))}>
                <Repeat size={20} strokeWidth={1.7} />
              </button>
            )}
            <button type="button" aria-label="Send to Edit" data-tip="Send to Edit" aria-expanded={panel === "send"} className={btn} onClick={() => toggle("send")}>
              <WandSparkles size={20} strokeWidth={1.7} />
            </button>
            {canCompare && (
              <button type="button" aria-label={compare ? "Hide before / after" : "Compare with the original"} data-tip="Before / after" aria-pressed={compare} className={btn} onClick={() => setCompare((c) => !c)}>
                <Columns2 size={20} strokeWidth={1.7} />
              </button>
            )}
            <button
              type="button"
              aria-label="Reuse settings"
              data-tip="Reuse settings"
              className={btn}
              onClick={() => {
                onLeave(); // leave the viewer first: the seed question and the destination tab live behind it
                reuseAny(job);
              }}
            >
              <RotateCcw size={20} strokeWidth={1.7} />
            </button>
            {enhancedText(job) && (
              <button type="button" aria-label="Prompt used" data-tip="Prompt used" aria-expanded={panel === "prompt"} className={btn} onClick={() => toggle("prompt")}>
                <TextQuote size={20} strokeWidth={1.7} />
              </button>
            )}
            <button type="button" aria-label="Details" data-tip="Details" aria-expanded={panel === "details"} className={btn} onClick={() => toggle("details")}>
              <Info size={20} strokeWidth={1.7} />
            </button>
            <button type="button" aria-label={canDelete ? "Delete" : "Remove from history"} data-tip={canDelete ? "Delete" : "Remove from history"} aria-expanded={panel === "delete"} className={`${btn} text-[#ef7b6c]`} onClick={() => toggle("delete")}>
              <Trash2 size={20} strokeWidth={1.7} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const SLIDE_MS = 240;
/** Resting place of a neighbouring slide: one width (plus a small gap) to the left or right of the screen. */
const rest = (side: -1 | 1) => `translate3d(calc(${side * 100}% + ${side * GAP_PX}px), 0, 0)`;

/** A picture waiting beside the current one, so the swipe shows what is coming. Only the picture: no controls. */
function NeighborSlide({ job, side, slideRef }: { job: Job | undefined; side: -1 | 1; slideRef: RefObject<HTMLDivElement | null> }) {
  const i = job ? Math.max(0, job.outputs.findIndex((o) => o.role === "final")) : 0;
  return (
    <div ref={slideRef} aria-hidden className="pointer-events-none absolute inset-0 will-change-transform" style={{ transform: rest(side) }}>
      {job && <img src={imageUrl(job.id, i)} alt="" decoding="async" draggable={false} className="h-full w-full object-contain" />}
    </div>
  );
}

/**
 * Full-screen viewer for the gallery, a carousel: the previous and next pictures sit beside the current one and follow your
 * finger, so you see them arrive; release past a third of the width (or flick) to move on, otherwise it springs back.
 * Arrow keys and the side buttons slide the same way. Pinch / double-tap / wheel zoom (a zoomed picture pans instead of
 * swiping). The controls stay on screen; a tap on the picture hides them and the next tap brings them back. Back or Esc closes it.
 */
export function GalleryViewer({
  items,
  id,
  hasMore,
  onChange,
  onNeedMore,
  onClose,
}: {
  items: Job[];
  id: string;
  hasMore: boolean;
  onChange: (id: string) => void;
  onNeedMore: () => void;
  onClose: () => void;
}) {
  const [locked, setLocked] = useState(false);
  const { visible, poke, toggle } = useChrome(locked);
  const idx = items.findIndex((j) => j.id === id);
  const job = items[idx];
  const prevJob = items[idx - 1];
  const nextJob = items[idx + 1];
  const lastIdx = useRef(0);
  if (idx >= 0) lastIdx.current = idx;
  const area = useRef<HTMLDivElement>(null);
  const curEl = useRef<HTMLDivElement>(null);
  const prevEl = useRef<HTMLDivElement>(null);
  const nextEl = useRef<HTMLDivElement>(null);
  const zoomed = useRef(false);
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  const animating = useRef(false);
  const press = useRef<{ x: number; y: number; t: number; ids: Set<number>; multi: boolean; ignore: boolean; dragging: boolean; lx: number; lt: number; v: number } | null>(null);
  const tapTimer = useRef(0);
  const lastTap = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedByHistory = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const idRef = useRef(id);
  idRef.current = id;

  // The shown job was deleted: move to the one that took its place, or leave when none is left.
  useEffect(() => {
    if (idx >= 0) return;
    const next = afterRemoval(items, lastIdx.current);
    if (next) onChange(next);
    else onClose();
  }, [idx, items, onChange, onClose]);

  // The phone's back button (and the browser's) closes the viewer instead of leaving the gallery.
  useEffect(() => {
    history.pushState({ accioViewer: true }, "");
    const onPop = () => {
      closedByHistory.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!closedByHistory.current && (history.state as { accioViewer?: boolean } | null)?.accioViewer) history.back();
    };
  }, []);

  /** Place the three slides for a horizontal offset of `px` (0 = resting), with or without an animation. */
  const place = useCallback((px: number, ms: number) => {
    const w = (area.current?.clientWidth ?? 0) + GAP_PX;
    const put = (el: HTMLDivElement | null, base: number) => {
      if (!el) return;
      el.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.22, 0.8, 0.3, 1)` : "none";
      el.style.transform = `translate3d(${base + px}px, 0, 0)`;
    };
    put(prevEl.current, -w);
    put(curEl.current, 0);
    put(nextEl.current, w);
  }, []);

  // A new current image: everything goes back to its resting place in the same frame the new picture appears, so the
  // slide that just arrived is replaced by the identical live picture without a flicker.
  useLayoutEffect(() => {
    for (const [el, side] of [[prevEl.current, -1], [nextEl.current, 1]] as const) {
      if (!el) continue;
      el.style.transition = "none";
      el.style.transform = rest(side);
    }
    if (curEl.current) {
      curEl.current.style.transition = "none";
      curEl.current.style.transform = "";
    }
    animating.current = false;
  }, [id]);

  /** Slide to the neighbour (step ±1) or spring back (0), then make it current. */
  const settle = useCallback(
    (step: -1 | 0 | 1) => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const w = (area.current?.clientWidth ?? 0) + GAP_PX;
      const target = neighborId(itemsRef.current, idRef.current, step);
      if (step === 0 || !target) {
        place(0, reduce ? 0 : 200);
        return;
      }
      animating.current = true;
      place(-step * w, reduce ? 0 : SLIDE_MS);
      window.setTimeout(() => onChange(target), reduce ? 0 : SLIDE_MS);
    },
    [onChange, place],
  );
  const go = useCallback(
    (step: -1 | 1) => {
      if (animating.current || !neighborId(itemsRef.current, idRef.current, step)) return;
      settle(step);
    },
    [settle],
  );

  // Keep the next page coming while the user pages through.
  useEffect(() => {
    if (hasMore && idx >= items.length - 4) onNeedMore();
  }, [hasMore, idx, items.length, onNeedMore]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, poke]);
  useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  const onDown = (e: ReactPointerEvent) => {
    if (animating.current) return;
    const ignore = !!(e.target as HTMLElement).closest("[data-no-swipe]");
    if (!press.current) press.current = { x: e.clientX, y: e.clientY, t: performance.now(), ids: new Set(), multi: false, ignore, dragging: false, lx: e.clientX, lt: performance.now(), v: 0 };
    press.current.ids.add(e.pointerId);
    if (press.current.ids.size > 1) {
      press.current.multi = true;
      if (press.current.dragging) {
        press.current.dragging = false; // a second finger: this is a pinch, drop the swipe
        place(0, 150);
      }
    }
  };
  const onMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p || p.ignore || p.multi || zoomed.current || lockedRef.current) return;
    const dx = e.clientX - p.x;
    if (!p.dragging) {
      if (!isDragStart(dx, e.clientY - p.y)) return;
      p.dragging = true;
      window.clearTimeout(tapTimer.current);
    }
    const now = performance.now();
    if (now > p.lt) p.v = 0.7 * p.v + 0.3 * ((e.clientX - p.lx) / (now - p.lt)); // smoothed px per ms
    p.lx = e.clientX;
    p.lt = now;
    place(resist(dx, !!prevJob, !!nextJob), 0);
  };
  const onUp = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p) return;
    p.ids.delete(e.pointerId);
    if (p.ids.size > 0) return; // wait for the last finger
    press.current = null;
    if (p.ignore) return;
    const dx = e.clientX - p.x;
    if (p.dragging) {
      settle(dragOutcome(dx, area.current?.clientWidth ?? 1, p.v, !!prevJob, !!nextJob));
    } else if (!p.multi && isTap(dx, e.clientY - p.y, performance.now() - p.t)) {
      // A single tap shows / hides the controls; a second tap soon after is the zoom double-tap and must not toggle.
      const now = performance.now();
      window.clearTimeout(tapTimer.current);
      if (now - lastTap.current < 320) lastTap.current = 0;
      else {
        lastTap.current = now;
        tapTimer.current = window.setTimeout(toggle, 280);
      }
    }
  };
  const onCancel = () => {
    if (press.current?.dragging) place(0, 150);
    press.current = null;
  };

  if (!job) return null;
  const chevron = `hidden md:grid absolute top-1/2 z-[5] h-12 w-12 -translate-y-1/2 place-items-center rounded-full ${glass} hover-wash transition-opacity duration-200 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      className={`fade-in fixed inset-0 z-50 select-none overflow-hidden bg-black ${visible ? "" : "cursor-none"}`}
      onPointerMove={(e) => e.pointerType === "mouse" && poke()}
    >
      <div ref={area} className="absolute inset-0 overflow-hidden" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
        <NeighborSlide job={prevJob} side={-1} slideRef={prevEl} />
        <NeighborSlide job={nextJob} side={1} slideRef={nextEl} />
        <ViewerFrame key={job.id} job={job} stageRef={curEl} chrome={visible} onLock={setLocked} onZoom={(z) => (zoomed.current = z)} onLeave={onClose} />
      </div>

      <div
        data-no-swipe
        className={`safe-t absolute inset-x-0 top-0 z-[5] flex items-center justify-between px-3 pt-2 transition-opacity duration-200 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <button type="button" aria-label="Close viewer" data-tip="Close (Esc)" onClick={onClose} className={`${glass} hover-wash grid h-11 w-11 place-items-center rounded-full`}>
          <X size={20} strokeWidth={1.7} />
        </button>
        <div className={`${glass} flex max-w-[60%] items-center gap-2 rounded-full px-3.5 py-2 text-[12px]`} aria-live="polite">
          <span className="truncate">{shortLabel(job)}</span>
          <span className="flex-none font-mono text-[#b9b2a3]">
            {idx + 1} / {items.length}
            {hasMore ? "+" : ""}
          </span>
        </div>
        <span className="h-11 w-11" aria-hidden />
      </div>

      {prevJob && (
        <button data-no-swipe type="button" aria-label="Previous image" data-tip="Previous ( ← )" onClick={() => go(-1)} className={`${chevron} left-3`}>
          <ChevronLeft size={24} strokeWidth={1.7} />
        </button>
      )}
      {nextJob && (
        <button data-no-swipe type="button" aria-label="Next image" data-tip="Next ( → )" onClick={() => go(1)} className={`${chevron} right-3`}>
          <ChevronRight size={24} strokeWidth={1.7} />
        </button>
      )}
    </div>
  );
}
