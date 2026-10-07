import { useEffect } from "react";
import { startSocket } from "./api/socket";
import { Settings } from "./components/Settings";
import { TooltipLayer } from "./components/ui/Tooltip";
import { cancelCurrent, generate } from "./features/create/actions";
import { DesktopLayout } from "./layout/DesktopLayout";
import { MobileLayout } from "./layout/MobileLayout";
import { useIsDesktop } from "./lib/useMedia";
import { useServer } from "./store/health";
import { isActive, useJobs } from "./store/jobs";
import { useUi, type Tab } from "./store/ui";

const TABS: Record<string, Tab> = { "1": "create", "2": "edit", "3": "gallery" };

function useStartup() {
  const connected = useJobs((s) => s.connected);
  const online = useServer((s) => s.health?.comfy_online);
  useEffect(startSocket, []);
  // Health and catalog are re-read whenever the live connection (re)appears; while ComfyUI is down, keep checking.
  useEffect(() => {
    void useServer.getState().refreshHealth();
    void useServer.getState().refreshCatalog();
  }, [connected]);
  useEffect(() => {
    if (online !== false) return;
    const t = setInterval(() => {
      void useServer.getState().refreshHealth();
      void useServer.getState().refreshCatalog();
    }, 10_000);
    return () => clearInterval(t);
  }, [online]);
}

/** Desktop shortcuts: Ctrl+Enter generate, Esc cancel, 1/2/3 switch mode (not while typing). */
function useShortcuts(desktop: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const running = () => Object.values(useJobs.getState().jobs).some(isActive);
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        if (useUi.getState().tab === "create" && !running()) void generate();
        e.preventDefault();
      } else if (e.key === "Escape" && running() && !document.querySelector('[role="dialog"]')) {
        void cancelCurrent();
      } else if (desktop && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && TABS[e.key]) {
        useUi.getState().set({ tab: TABS[e.key]! });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop]);
}

export function App() {
  const desktop = useIsDesktop();
  useStartup();
  useShortcuts(desktop);
  return (
    <>
      {desktop ? <DesktopLayout /> : <MobileLayout />}
      <Settings />
      <TooltipLayer />
    </>
  );
}
