import { ChevronLeft, LayoutGrid, Settings as GearIcon, Sparkles, WandSparkles } from "lucide-react";
import { Wordmark } from "../components/Wordmark";
import { HealthBanner } from "../components/HealthBanner";
import { IconButton } from "../components/ui/controls";
import { Sheet } from "../components/ui/Sheet";
import { CreateAdvanced } from "../features/create/CreateAdvanced";
import { CreateComposer } from "../features/create/CreateComposer";
import { EditSoon, GallerySoon } from "../features/edit/ComingSoon";
import { Thumb } from "../features/history/Thumb";
import { SelectedStage, EmptyStage } from "../components/stage/Stage";
import { jobSize } from "../lib/jobView";
import { useCreate } from "../features/create/store";
import { isActive, useJobs } from "../store/jobs";
import { useUi, type Tab } from "../store/ui";
import { useShallow } from "zustand/react/shallow";

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "create", label: "Create", icon: Sparkles },
  { id: "edit", label: "Edit", icon: WandSparkles },
  { id: "gallery", label: "Gallery", icon: LayoutGrid },
];

/** Feed of finished results; tapping one opens it full screen. */
function Feed() {
  const jobs = useJobs(useShallow((s) => s.order.map((id) => s.jobs[id]!).filter((j) => j.mode === "create" && (j.status === "done" || isActive(j)))));
  if (!jobs.length) return <EmptyStage />;
  return (
    <ul className="grid grid-cols-2 items-start gap-1.5 overflow-y-auto p-2.5">
      {jobs.map((j) => {
        const { w, h } = jobSize(j);
        return (
          <li key={j.id}>
            <button
              type="button"
              aria-label={`Open: ${String(j.params.prompt ?? "").slice(0, 60)}`}
              onClick={() => {
                useJobs.getState().select(j.id);
                useUi.getState().set({ viewerOpen: true });
              }}
              className="block w-full overflow-hidden rounded-m border border-line"
              style={{ aspectRatio: `${w} / ${h}` }}
            >
              <Thumb job={j} className="h-full w-full" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CreateMobile() {
  const viewerOpen = useUi((s) => s.viewerOpen);
  const advancedOpen = useUi((s) => s.advancedOpen);
  const set = useUi((s) => s.set);
  const variant = useCreate((s) => s.variant);
  return (
    <>
      <div className="relative min-h-0 flex-1">
        {viewerOpen ? (
          <div className="h-full p-2.5">
            <SelectedStage />
            <button
              type="button"
              aria-label="Back to results"
              onClick={() => set({ viewerOpen: false })}
              className="absolute left-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-[rgba(10,9,14,0.62)] text-[#f1eadb] backdrop-blur-md"
            >
              <ChevronLeft size={22} strokeWidth={1.7} />
            </button>
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <Feed />
          </div>
        )}
      </div>
      <CreateComposer layout="dock" />
      <Sheet open={advancedOpen} onClose={() => set({ advancedOpen: false })} title={variant === "detailed" ? "Advanced · Detailed" : "Advanced"}>
        <CreateAdvanced withAspect />
      </Sheet>
    </>
  );
}

export function MobileLayout() {
  const tab = useUi((s) => s.tab);
  const set = useUi((s) => s.set);
  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="safe-t flex flex-none items-center justify-between px-3.5">
        <div className="flex h-12 items-center">
          <Wordmark size={24} />
        </div>
        <IconButton label="Settings" onClick={() => set({ settingsOpen: true })}>
          <GearIcon size={20} strokeWidth={1.7} />
        </IconButton>
      </header>
      <HealthBanner />
      <main className="flex min-h-0 flex-1 flex-col">
        {tab === "create" ? <CreateMobile /> : tab === "edit" ? <EditSoon /> : <GallerySoon />}
      </main>
      <nav aria-label="Main" className="safe-b grid flex-none grid-cols-3 border-t border-line bg-surface">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => set({ tab: id })}
            className={`flex h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${tab === id ? "text-gold-text" : "text-text-3"}`}
          >
            <Icon size={22} strokeWidth={1.7} />
            {label}
            <i className={`mt-0.5 h-[3px] w-4 rounded-full ${tab === id ? "bg-gold-ui" : "bg-transparent"}`} />
          </button>
        ))}
      </nav>
    </div>
  );
}
