import { Suspense, lazy } from "react";
import { ChevronLeft } from "lucide-react";
import { JobStage } from "../../components/stage/Stage";
import { useIsDesktop } from "../../lib/useMedia";
import { useJobs } from "../../store/jobs";
import { useUi } from "../../store/ui";
import { useEdit } from "./store";
import { usePasteImages } from "./ImagePicker";

// The editors carry the canvas code; they load when their mode is first opened (APP_SPEC 6.1a).
const SlotGrid = lazy(() => import("./SlotGrid").then((m) => ({ default: m.SlotGrid })));
const MaskEditor = lazy(() => import("./MaskEditor").then((m) => ({ default: m.MaskEditor })));
const OutpaintEditor = lazy(() => import("./OutpaintEditor").then((m) => ({ default: m.OutpaintEditor })));

/** The Edit canvas: the editor of the current mode, or the result of the selected Edit job with a way back. */
export function EditCanvas() {
  const mode = useEdit((s) => s.mode);
  const desktop = useIsDesktop();
  const viewerOpen = useUi((s) => s.viewerOpen);
  const job = useJobs((s) => {
    const j = s.selectedId ? s.jobs[s.selectedId] : undefined;
    return j && j.mode === mode ? j : undefined;
  });
  usePasteImages(mode);

  if (job && (desktop || viewerOpen)) {
    return (
      <div className="relative h-full">
        <JobStage job={job} />
        <button
          type="button"
          aria-label="Back to the editor"
          data-tip="Back to the editor"
          onClick={() => {
            useJobs.getState().select(null);
            useUi.getState().set({ viewerOpen: false });
          }}
          className="absolute left-2 top-2 z-10 flex h-11 items-center gap-1 rounded-full border border-white/10 bg-[rgba(10,9,14,0.62)] pl-2.5 pr-3.5 text-[13px] font-medium text-[#f1eadb] backdrop-blur-md"
        >
          <ChevronLeft size={20} strokeWidth={1.7} /> Editor
        </button>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="h-full animate-pulse rounded-m border border-line bg-raised motion-reduce:animate-none" aria-busy />}>
      {mode === "multiedit" ? <SlotGrid /> : mode === "inpaint" ? <MaskEditor /> : <OutpaintEditor />}
    </Suspense>
  );
}
