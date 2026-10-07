import { LayoutGrid, Settings as GearIcon, Sparkles, WandSparkles } from "lucide-react";
import { HealthBanner } from "../components/HealthBanner";
import { IconButton } from "../components/ui/controls";
import { SelectedStage } from "../components/stage/Stage";
import { Wordmark } from "../components/Wordmark";
import { CreateComposer } from "../features/create/CreateComposer";
import { useCreate } from "../features/create/store";
import { EditSoon, GallerySoon } from "../features/edit/ComingSoon";
import { HistoryPane, QueuePane, RecentStrip } from "../features/history/SidePanes";
import { jobSize, passOf } from "../lib/jobView";
import { useJobs } from "../store/jobs";
import { useUi, type Tab } from "../store/ui";

const NAV: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "create", label: "Create", icon: Sparkles },
  { id: "edit", label: "Edit", icon: WandSparkles },
  { id: "gallery", label: "Gallery", icon: LayoutGrid },
];

function ContextLine() {
  const job = useJobs((s) => (s.selectedId ? s.jobs[s.selectedId] : undefined));
  const variant = useCreate((s) => s.variant);
  if (!job) return <span className="text-[13px] text-text-3">{variant === "detailed" ? "Detailed" : "Standard"}</span>;
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
          data-tip={`${label} (${i + 1})`}
          onClick={() => set({ tab: id })}
          className={`flex h-11 items-center gap-2.5 rounded-xl px-3 text-[14px] font-medium ${tab === id ? "bg-gold-wash text-gold-text" : "text-text-2"}`}
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
          <IconButton label="Settings" onClick={() => set({ settingsOpen: true })} className="h-9 w-9">
            <GearIcon size={20} strokeWidth={1.7} />
          </IconButton>
        </div>
        {tab === "create" ? (
          <CreateComposer layout="pane" above={nav} />
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
            {nav}
            <p className="text-[13px] text-text-3">Controls for this mode arrive with it.</p>
          </div>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col" aria-label="Canvas">
        <HealthBanner />
        <div className="flex h-14 flex-none items-center px-4">
          <ContextLine />
        </div>
        <div className="min-h-0 flex-1 px-4 pb-4">{tab === "create" ? <SelectedStage /> : tab === "edit" ? <EditSoon /> : <GallerySoon />}</div>
        {tab === "create" && <RecentStrip />}
      </section>

      <aside className="flex min-h-0 flex-col border-l border-line bg-surface" aria-label="Queue and history">
        <QueuePane />
        <HistoryPane />
      </aside>
    </div>
  );
}
