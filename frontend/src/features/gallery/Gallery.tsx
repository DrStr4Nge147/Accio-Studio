import { Check, CheckSquare, Download, Loader2, Share2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteJob, fetchDoneJobs } from "../../api/endpoints";
import { ApiError, imageUrl } from "../../api/http";
import type { Job } from "../../api/types";
import { openContextMenu } from "../../components/ui/ContextMenu";
import { Segmented } from "../../components/ui/controls";
import { gridLayout, itemPosition, nearEnd, visibleRange } from "../../lib/virtualGrid";
import { jobGroup, shortLabel, type JobGroup } from "../../lib/jobView";
import { useServer } from "../../store/health";
import { useJobs } from "../../store/jobs";
import { jobMenuItems } from "../history/jobMenu";
import { coverIndex, Thumb } from "../history/Thumb";
import { canShareFiles, downloadImages, shareImages } from "../../lib/share";
import { GalleryViewer } from "./GalleryViewer";

type Filter = "all" | JobGroup;
const PAGE = 60;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "create", label: "Create" },
  { value: "edit", label: "Edit" },
];

/** Newest first, no duplicates: finished jobs the live store already knows about on top of what the pages loaded. */
export function mergeJobs(loaded: Job[], live: Job[], filter: Filter): Job[] {
  const byId = new Map<string, Job>();
  for (const j of [...loaded, ...live]) {
    if (j.status === "done" && j.outputs.length > 0 && (filter === "all" || jobGroup(j) === filter)) byId.set(j.id, j);
  }
  return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
}

/** Every finished image, newest first: a virtualized grid (only the visible rows exist in the DOM) with paged loading. */
export function Gallery() {
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState<Job[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null); // the image open in the full-screen viewer
  const canDelete = useServer((s) => s.health?.can_delete_files === true); // Accio owns the output folder
  const live = useJobs(useShallow((s) => s.order.map((id) => s.jobs[id]!).filter((j) => j.status === "done")));
  const known = useJobs((s) => s.jobs); // jobs deleted elsewhere (right-click menu) leave the store
  const items = useMemo(() => mergeJobs(loaded.filter((j) => known[j.id]), live, filter), [loaded, known, live, filter]);

  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0, top: 0 });
  const raf = useRef(0);
  const generation = useRef(0); // ignores pages that answer after the filter changed

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const pad = getComputedStyle(el); // the grid lives inside the scroller's horizontal padding
      const w = el.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
      setView((v) => ({ ...v, w, h: el.clientHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(
    async (reset: boolean, before?: number) => {
      const gen = reset ? ++generation.current : generation.current;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchDoneJobs({ before, group: filter === "all" ? undefined : filter, limit: PAGE });
        if (gen !== generation.current) return;
        useJobs.getState().upsert(page); // so opening one finds it in the store
        setLoaded((prev) => (reset ? page : [...prev, ...page]));
        setHasMore(page.length === PAGE);
      } catch (e) {
        if (gen === generation.current) setError(e instanceof ApiError ? e.message : "Couldn't load the gallery.");
      } finally {
        if (gen === generation.current) setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    setLoaded([]);
    setHasMore(true);
    if (scroller.current) scroller.current.scrollTop = 0;
    void load(true);
  }, [load]);

  const layout = useMemo(() => gridLayout(view.w, items.length, view.w < 480 ? 104 : 150), [view.w, items.length]);
  const range = visibleRange(layout, view.top, view.h, items.length);

  // Page in more while the viewport is near the end (and also when the first page does not fill the screen).
  useEffect(() => {
    if (!hasMore || loading || error || !loaded.length) return;
    if (nearEnd(layout, view.top, view.h)) void load(false, loaded[loaded.length - 1]!.created_at);
  }, [hasMore, loading, error, loaded, layout, view.top, view.h, load]);

  const loadMore = useCallback(() => {
    if (hasMore && !loading && !error && loaded.length) void load(false, loaded[loaded.length - 1]!.created_at);
  }, [hasMore, loading, error, loaded, load]);

  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setView((v) => ({ ...v, top: scroller.current?.scrollTop ?? 0 })));
  };

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const allPicked = items.length > 0 && items.every((j) => picked.has(j.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(items.map((j) => j.id)));
  const toggleAllRef = useRef(toggleAll);
  toggleAllRef.current = toggleAll;
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        toggleAllRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
    setConfirm(false);
  };

  const removePicked = async () => {
    setBusy(true);
    const ids = [...picked];
    const results = await Promise.allSettled(ids.map((id) => deleteJob(id)));
    const gone = ids.filter((_, i) => results[i]!.status === "fulfilled");
    useJobs.getState().remove(gone);
    setLoaded((l) => l.filter((j) => !gone.includes(j.id)));
    const kept = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.files_kept : 0), 0);
    if (gone.length < ids.length) setError("Some images couldn't be removed. Try again.");
    else if (kept > 0 && canDelete) setError(`${kept} image file${kept === 1 ? "" : "s"} couldn't be deleted from disk (removed from the gallery only).`);
    setBusy(false);
    stopSelecting();
  };

  const pickedImages = () =>
    items
      .filter((j) => picked.has(j.id))
      .map((j) => {
        const i = coverIndex(j);
        return { url: imageUrl(j.id, i), filename: `accio-${j.seeds.main ?? j.seeds.pass1 ?? "image"}-${i + 1}.png` };
      });
  const downloadPicked = async () => {
    setBusy(true);
    await downloadImages(pickedImages());
    setBusy(false);
  };
  const sharePicked = async () => {
    setBusy(true);
    try {
      if (!(await shareImages(pickedImages()))) setError("Your browser can't share this many images at once.");
    } catch {
      /* the share sheet was dismissed */
    }
    setBusy(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 px-3.5 pb-2.5 pt-1 lg:px-4">
        <Segmented<Filter> label="Show" value={filter} options={FILTERS} onChange={(f) => setFilter(f)} small />
        <div className="ml-auto flex items-center gap-2">
          {selecting ? (
            <>
              <span className="text-[13px] text-text-2">{picked.size} selected</span>
              {!confirm && (
                <button
                  type="button"
                  onClick={toggleAll}
                  data-tip={hasMore ? "Selects the images loaded so far (Ctrl+A)" : "Ctrl+A"}
                  className="hover-wash h-11 rounded-full border border-line-strong px-3.5 text-[13px] text-text-2 hover:text-text"
                >
                  {allPicked ? "Clear" : "Select all"}
                </button>
              )}
              {confirm ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removePicked()}
                  className="flex h-11 items-center gap-1.5 rounded-full bg-danger px-4 text-[13px] font-semibold text-bg disabled:opacity-60"
                >
                  {busy && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />}
                  {canDelete ? `Delete ${picked.size} permanently` : `Remove ${picked.size} from history`}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!picked.size || busy}
                    onClick={() => void downloadPicked()}
                    className="hover-wash flex h-11 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] text-text-2 hover:text-text disabled:opacity-40"
                  >
                    <Download size={16} strokeWidth={1.7} />
                    Download
                  </button>
                  {canShareFiles() && (
                    <button
                      type="button"
                      disabled={!picked.size || busy}
                      onClick={() => void sharePicked()}
                      className="hover-wash flex h-11 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] text-text-2 hover:text-text disabled:opacity-40"
                    >
                      <Share2 size={16} strokeWidth={1.7} />
                      Share
                    </button>
                  )}
                <button
                  type="button"
                  disabled={!picked.size}
                  onClick={() => setConfirm(true)}
                  className="hover-wash flex h-11 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] text-text-2 hover:text-text disabled:opacity-40"
                >
                  <Trash2 size={16} strokeWidth={1.7} />
                  {canDelete ? "Delete" : "Remove"}
                </button>
                </>
              )}
              <button type="button" aria-label="Stop selecting" data-tip="Stop selecting" onClick={stopSelecting} className="hover-wash grid h-11 w-11 place-items-center rounded-full text-text-2 hover:text-text">
                <X size={18} strokeWidth={1.7} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              disabled={!items.length}
              className="hover-wash flex h-11 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] text-text-2 hover:text-text disabled:opacity-40"
            >
              <CheckSquare size={16} strokeWidth={1.7} />
              Select
            </button>
          )}
        </div>
      </div>
      {confirm && <p className="flex-none px-4 pb-2 text-[12px] text-text-3">{canDelete
            ? "This permanently deletes the images from your computer's output folder and from the gallery. It can't be undone."
            : "This removes them from Accio's history only. The image files stay where the backend saved them."}</p>}
      {selecting && !confirm && hasMore && allPicked && <p className="flex-none px-4 pb-2 text-[12px] text-text-3">Only the {items.length} images loaded so far are selected. Scroll down to load more, then select all again.</p>}

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3 lg:px-4" aria-label="Gallery">
        {items.length === 0 && !loading && !error && (
          <p className="p-6 text-center text-[14px] text-text-3">{filter === "all" ? "Finished images show up here." : `No ${filter} images yet.`}</p>
        )}
        <ul className="relative" style={{ height: layout.totalHeight }}>
          {items.slice(range.first, range.last).map((job, i) => {
            const index = range.first + i;
            const { x, y } = itemPosition(layout, index);
            const on = picked.has(job.id);
            return (
              <li key={job.id} className="absolute left-0 top-0" style={{ width: layout.cell, height: layout.cell, transform: `translate(${x}px, ${y}px)` }}>
                <button
                  type="button"
                  aria-label={`${selecting ? (on ? "Deselect" : "Select") : "Open"}: ${String(job.params.prompt || job.label).slice(0, 60)}`}
                  aria-pressed={selecting ? on : undefined}
                  data-tip={String(job.params.prompt || job.label).slice(0, 140)}
                  onClick={() => (selecting ? toggle(job.id) : setViewId(job.id))}
                  onContextMenu={selecting ? undefined : (e) => openContextMenu(e, jobMenuItems(job))}
                  className={`relative block h-full w-full overflow-hidden rounded-s border ${on ? "border-gold" : "border-line hover:border-text-3"}`}
                >
                  <Thumb job={job} size={layout.cell > 190 ? 1024 : 384} className="h-full w-full" />
                  <span className="absolute bottom-1 left-1 rounded-md bg-[rgba(10,9,14,0.62)] px-1.5 py-0.5 text-[10px] font-medium text-[#f1eadb]">{shortLabel(job)}</span>
                  {selecting && (
                    <span className={`absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border ${on ? "border-gold bg-gold text-on-gold" : "border-white/60 bg-[rgba(10,9,14,0.5)]"}`}>
                      {on && <Check size={14} strokeWidth={2.4} />}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {loading && (
          <div className="grid place-items-center py-4 text-text-3" role="status" aria-label="Loading">
            <Loader2 size={20} className="animate-spin motion-reduce:animate-none" />
          </div>
        )}
        {error && (
          <p className="py-4 text-center text-[13px] text-danger" role="alert">
            {error}{" "}
            <button type="button" className="underline" onClick={() => void load(!loaded.length, loaded[loaded.length - 1]?.created_at)}>
              Try again
            </button>
          </p>
        )}
      </div>
      {viewId && <GalleryViewer items={items} id={viewId} hasMore={hasMore} onChange={setViewId} onNeedMore={loadMore} onClose={() => setViewId(null)} />}
    </div>
  );
}
