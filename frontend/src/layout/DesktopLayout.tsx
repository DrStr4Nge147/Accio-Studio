import { LayoutGrid, Settings as GearIcon, Sparkles, WandSparkles } from "lucide-react";
import { CoffeeBadge } from "../components/CoffeeBadge";
import { HealthBanner } from "../components/HealthBanner";
import { IconButton } from "../components/ui/controls";
import { StatsBadge } from "../components/StatsBadge";
import { UpdatePill } from "../components/UpdatePill";
import { SelectedStage } from "../components/stage/Stage";
import { Wordmark } from "../components/Wordmark";
import { ConsoleDrawer } from "../features/console/ConsoleDrawer";
import { CreateComposer } from "../features/create/CreateComposer";
import { useCreate } from "../features/create/store";
import { EditCanvas } from "../features/edit/EditCanvas";
import { EditComposer } from "../features/edit/EditComposer";
import { EditModeSwitch } from "../features/edit/EditControls";
import { EDIT_MODES, useEdit } from "../features/edit/store";
import { LazyGallery } from "../features/gallery/LazyGallery";
import { HistoryPane, QueuePane, RecentStrip } from "../features/history/SidePanes";
import { jobGroup, jobSize, passOf, shortLabel } from "../lib/jobView";
import { useJobs } from "../store/jobs";
import { useUi, type Tab } from "../store/ui";

const NAV: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "create", label: "Create", icon: Sparkles },
  { id: "edit", label: "Edit", icon: WandSparkles },
  { id: "gallery", label: "Gallery", icon: LayoutGrid },
];

function ContextLine() {
  const tab = useUi((s) => s.tab);
  const job = useJobs((s) => {
    const j = s.selectedId ? s.jobs[s.selectedId] : undefined;
    return j && jobGroup(j) === (tab === "edit" ? "edit" : "create") ? j : undefined;
  });
  const variant = useCreate((s) => s.variant);
  const editMode = useEdit((s) => s.mode);
  if (tab === "edit") {
    const label = EDIT_MODES.find((m) => m.value === editMode)?.label;
    if (!job) return <span className="text-[13px] text-text-3">{label}</span>;
    const { w, h } = jobSize(job);
    return (
      <span className="text-[13px] text-text-3">
        {shortLabel(job)} · {w}×{h}
      </span>
    );
  }
  if (!job) return <span className="text-[13px] text-text-3">{variant === "detailed" ? "Detailed" : variant === "moss" ? "MOSS" : "Standard"}</span>;
  const { w, h } = jobSize(job);
  const pass = job.status === "running" ? passOf(job) : null;
  return (
    <span className="text-[13px] text-text-3">
      {job.label.replace("Create · ", "")} · {w}×{h}
      {pass && ` · pass ${pass.pass} of ${pass.of}`}
    </span>
  );
}

/** Three panes (>= 1024 px): mode nav + composer, canvas, queue + history. */
export function DesktopLayout() {
  const tab = useUi((s) => s.tab);
  const set = useUi((s) => s.set);
  const nav = (
    <nav aria-label="Main" className="flex flex-none flex-col gap-1">
      {NAV.map(({ id, label, icon: Icon }, i) => (
        <button
          key={id}
          type="button"
          aria-current={tab === id ? "page" : undefined}
          onClick={() => set({ tab: id })}
          className={`flex h-11 items-center gap-2.5 rounded-xl px-3 text-[14px] font-medium ${tab === id ? "bg-gold-wash text-gold-text" : "text-text-2 hover:text-text hover-wash"} transition-colors`}
        >
          <Icon size={20} strokeWidth={1.7} />
          {label}
          <kbd className="ml-auto rounded-md border border-line-strong bg-raised px-1.5 font-mono text-[11px] text-text-2">{i + 1}</kbd>
        </button>
      ))}
    </nav>
  );
  return (
    <div className="grid h-full grid-cols-[316px_minmax(0,1fr)_272px] bg-bg">
      <aside className="flex min-h-0 flex-col border-r border-line bg-surface" aria-label="Controls">
        <div className="flex h-14 flex-none items-center justify-between border-b border-line px-4">
          <Wordmark size={24} />
          <div className="flex items-center gap-1.5">
            <CoffeeBadge compact />
            <IconButton label="Settings" onClick={() => set({ settingsOpen: true })} className="h-9 w-9">
              <GearIcon size={20} strokeWidth={1.7} />
            </IconButton>
          </div>
        </div>
        <div className="flex-none px-4 pt-3 empty:hidden">
          <UpdatePill label="Update available" className="w-full justify-center" />
        </div>
        {tab === "create" ? (
          <CreateComposer layout="pane" above={nav} />
        ) : tab === "edit" ? (
          <EditComposer
            layout="pane"
            above={
              <>
                {nav}
                <EditModeSwitch stretch />
              </>
            }
          />
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
            {nav}
            <p className="text-[13px] text-text-3">Open an image to see it large, reuse its settings or send it to Edit. Use Select to remove images from the history.</p>
          </div>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col" aria-label="Canvas">
        <HealthBanner />
        <div className="flex h-14 flex-none items-center justify-between gap-3 px-4">
          <ContextLine />
          <StatsBadge />
        </div>
        <div className="min-h-0 flex-1 px-4 pb-4">{tab === "create" ? <SelectedStage /> : tab === "edit" ? <EditCanvas /> : <LazyGallery />}</div>
        {tab !== "gallery" && <RecentStrip group={tab === "edit" ? "edit" : "create"} />}
        <ConsoleDrawer />
      </section>

      <aside className="flex min-h-0 flex-col border-l border-line bg-surface" aria-label="Queue and history">
        <QueuePane />
        {tab !== "gallery" && <HistoryPane group={tab === "edit" ? "edit" : "create"} />}
      </aside>
    </div>
  );
}
