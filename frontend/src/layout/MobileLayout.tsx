import { ArrowRight, ChevronLeft, ChevronRight, LayoutGrid, Maximize2, Settings as GearIcon, Sparkles, Terminal, WandSparkles } from "lucide-react";
import { CoffeeBadge } from "../components/CoffeeBadge";
import { UpdatePill } from "../components/UpdatePill";
import { Wordmark } from "../components/Wordmark";
import { HealthBanner } from "../components/HealthBanner";
import { SettingsBody } from "../components/Settings";
import { Sheet } from "../components/ui/Sheet";
import { ConsoleActions, ConsoleLog, useConsolePolling } from "../features/console/ConsoleDrawer";
import { CreateAdvanced } from "../features/create/CreateAdvanced";
import { CreateComposer } from "../features/create/CreateComposer";
import { EditAdvanced } from "../features/edit/EditAdvanced";
import { EditCanvas } from "../features/edit/EditCanvas";
import { EditComposer } from "../features/edit/EditComposer";
import { EditModeSwitch } from "../features/edit/EditControls";
import { EDIT_MODES, useEdit } from "../features/edit/store";
import { useWorkspace } from "../features/edit/workspace";
import { LazyGallery } from "../features/gallery/LazyGallery";
import { RecentStrip } from "../features/history/SidePanes";
import { Thumb } from "../features/history/Thumb";
import { SelectedStage, EmptyStage } from "../components/stage/Stage";
import { jobSize } from "../lib/jobView";
import { useCreate } from "../features/create/store";
import { isActive, useJobs } from "../store/jobs";
import { useUi, type Tab } from "../store/ui";
import { useShallow } from "zustand/react/shallow";
import { useEffect } from "react";

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "create", label: "Create", icon: Sparkles },
  { id: "edit", label: "Edit", icon: WandSparkles },
  { id: "gallery", label: "Gallery", icon: LayoutGrid },
  { id: "settings", label: "Settings", icon: GearIcon },
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
              <Thumb job={j} size={1024} className="h-full w-full" />
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
              data-tip="Back to results"
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

/** The last Inpaint image that opened the full-screen painter, so coming back to the tab does not reopen it. */
let paintedUrl: string | null = null;

/** Inpaint step 1: the whole screen is the canvas, so painting works with a thumb. Next goes on to the prompt. */
function PaintScreen() {
  const hasMask = useWorkspace((s) => s.inpaint.ops.length > 0);
  const set = useUi((s) => s.set);
  return (
    <div className="safe-t safe-b fixed inset-0 z-40 flex flex-col bg-bg">
      <div className="flex h-12 flex-none items-center gap-1 px-2">
        <button
          type="button"
          aria-label="Back to the editor"
          data-tip="Back to the editor"
          onClick={() => set({ maskFullscreen: false })}
          className="hover-wash grid h-11 w-11 place-items-center rounded-full text-text-2"
        >
          <ChevronLeft size={22} strokeWidth={1.7} />
        </button>
        <h2 className="text-[15px] font-medium">Paint what to change</h2>
      </div>
      <div className="min-h-0 flex-1 px-2.5 pb-2">
        <EditCanvas />
      </div>
      <div className="flex-none px-3.5 pb-3 pt-1">
        <button
          type="button"
          disabled={!hasMask}
          onClick={() => set({ maskFullscreen: false, promptOpen: { ...useUi.getState().promptOpen, inpaint: true } })}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-gold-hi to-gold text-[16px] font-semibold text-on-gold disabled:opacity-50"
        >
          Next <ArrowRight size={20} strokeWidth={1.7} />
        </button>
        {!hasMask && <p className="mt-1.5 text-center text-[12px] text-text-3">Paint over the area first.</p>}
      </div>
    </div>
  );
}

function EditMobile() {
  const advancedOpen = useUi((s) => s.advancedOpen);
  const set = useUi((s) => s.set);
  const mode = useEdit((s) => s.mode);
  const title = EDIT_MODES.find((m) => m.value === mode)?.label ?? "Edit";
  // Previewing a result: the prompt box is not needed (Prompt used has the text), so the picture gets the room.
  const viewerOpen = useUi((s) => s.viewerOpen);
  const selectedIsMode = useJobs((s) => s.jobs[s.selectedId ?? ""]?.mode === mode);
  const previewing = viewerOpen && selectedIsMode;
  const srcUrl = useWorkspace((s) => s.inpaint.src?.url);
  const maskFullscreen = useUi((s) => s.maskFullscreen);
  // While an image is open in the editor the canvas needs the height; Recent comes back when previewing or empty.
  const editing = useWorkspace((s) => (mode === "multiedit" ? s.slots.length > 0 : mode === "inpaint" ? !!s.inpaint.src : !!s.outpaint.src));
  // A newly chosen Inpaint image opens the full-screen painter.
  useEffect(() => {
    if (mode === "inpaint" && srcUrl && srcUrl !== paintedUrl) set({ maskFullscreen: true });
    if (srcUrl) paintedUrl = srcUrl;
  }, [mode, srcUrl, set]);
  if (mode === "inpaint" && srcUrl && maskFullscreen && !previewing) return <PaintScreen />;
  return (
    <>
      <div className="flex-none px-3.5 pb-2 [@media(max-height:700px)]:pb-1.5">
        <EditModeSwitch stretch />
      </div>
      {/* Inpaint here is only a preview under the full-screen button, so its tool strip is hidden (the painter has it). */}
      <div className={`relative min-h-0 flex-1 px-2.5 pb-2.5 ${mode === "inpaint" && !previewing ? "[&_[data-mask-tools]]:hidden" : ""}`}>
        <EditCanvas />
        {/* Too small to paint on a phone: the canvas is covered, and the button opens the full-screen painter. */}
        {mode === "inpaint" && srcUrl && !previewing && (
          <button
            type="button"
            aria-label="Paint in full screen"
            onClick={() => set({ maskFullscreen: true })}
            className="absolute inset-x-2.5 bottom-2.5 top-0 z-10 grid place-items-center rounded-m bg-black/35"
          >
            <span className="flex h-12 items-center gap-2 rounded-full bg-gradient-to-b from-gold-hi to-gold px-5 text-[15px] font-semibold text-on-gold shadow-float">
              <Maximize2 size={18} strokeWidth={1.7} /> Paint in full screen
            </span>
          </button>
        )}
      </div>
      {(previewing || !editing) && <RecentStrip group="edit" compact />}
      {!previewing && <EditComposer layout="dock" />}
      <Sheet open={advancedOpen} onClose={() => set({ advancedOpen: false })} title={`Advanced · ${title}`}>
        <EditAdvanced withPadding />
      </Sheet>
    </>
  );
}

/** Settings as the fourth tab: connection, theme, install, account, backend status; the console is one row away. */
function SettingsTab() {
  const set = useUi((s) => s.set);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1">
      <h1 className="serif mb-4 text-[22px] font-medium">Settings</h1>
      <SettingsBody open />
      <button
        type="button"
        onClick={() => set({ consoleOpen: true })}
        className="hover-wash mt-5 flex h-11 w-full items-center justify-between rounded-m border border-line px-3 text-[14px] text-text-2 hover:text-text"
      >
        <span className="flex items-center gap-2">
          <Terminal size={18} strokeWidth={1.7} /> Console
        </span>
        <ChevronRight size={18} strokeWidth={1.7} />
      </button>
    </div>
  );
}

export function MobileLayout() {
  const tab = useUi((s) => s.tab);
  const set = useUi((s) => s.set);
  const consoleOpen = useUi((s) => s.consoleOpen);
  useConsolePolling(consoleOpen, 1000);
  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="safe-t flex flex-none items-center justify-between px-3.5">
        <div className="flex h-12 items-center">
          <Wordmark size={24} />
        </div>
        <div className="flex items-center gap-1.5">
          <UpdatePill />
          <CoffeeBadge />
        </div>
      </header>
      <Sheet open={consoleOpen} onClose={() => set({ consoleOpen: false })} title="Console" height="70%">
        <div className="-mx-4 flex flex-col">
          <div className="flex justify-end px-2">
            <ConsoleActions />
          </div>
          <ConsoleLog className="h-[50vh] border-y border-line bg-bg" />
        </div>
      </Sheet>
      <HealthBanner />
      <main className="flex min-h-0 flex-1 flex-col">
        {tab === "create" ? <CreateMobile /> : tab === "edit" ? <EditMobile /> : tab === "settings" ? <SettingsTab /> : <LazyGallery />}
      </main>
      <nav aria-label="Main" className="safe-b grid flex-none grid-cols-4 border-t border-line bg-surface">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => set({ tab: id })}
            className={`flex h-[60px] [@media(max-height:700px)]:h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${tab === id ? "text-gold-text" : "text-text-3 hover:text-text-2"}`}
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
