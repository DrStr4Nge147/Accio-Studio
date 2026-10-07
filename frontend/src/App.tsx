import { useEffect } from "react";
import { startSocket } from "./api/socket";
import { AuthScreen } from "./features/auth/AuthScreen";
import { useAuth } from "./store/auth";
import { ReuseSeedPrompt } from "./components/ReuseSeedPrompt";
import { Settings } from "./components/Settings";
import { TooltipLayer } from "./components/ui/Tooltip";
import { cancelCurrent, generate } from "./features/create/actions";
import { generateEdit } from "./features/edit/actions";
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
        const tab = useUi.getState().tab;
        void (tab === "create" ? generate() : tab === "edit" ? generateEdit() : undefined);
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

function Main() {
  const desktop = useIsDesktop();
  useStartup();
  useShortcuts(desktop);
  return (
    <>
      {desktop ? <DesktopLayout /> : <MobileLayout />}
      <Settings />
      <ReuseSeedPrompt />
      <TooltipLayer />
    </>
  );
}

/** Nothing private is shown (or fetched) until the server confirms a session. */
export function App() {
  const status = useAuth((s) => s.status);
  const unreachable = useAuth((s) => s.unreachable);
  useEffect(() => {
    void useAuth.getState().refresh();
  }, []);
  useEffect(() => {
    if (status || !unreachable) return;
    const t = setInterval(() => void useAuth.getState().refresh(), 3000);
    return () => clearInterval(t);
  }, [status, unreachable]);
  if (!status) {
    return <div className="grid h-full place-items-center bg-bg text-[14px] text-text-3">{unreachable ? "Can't reach the Accio server. Retrying…" : ""}</div>;
  }
  if (!status.authenticated) {
    return (
      <>
        <AuthScreen />
        <TooltipLayer />
      </>
    );
  }
  return <Main />;
}
