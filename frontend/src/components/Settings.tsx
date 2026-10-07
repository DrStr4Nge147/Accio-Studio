import { useEffect } from "react";
import { useServer } from "../store/health";
import { useJobs } from "../store/jobs";
import { AccountSection } from "../features/settings/AccountSection";
import { ConnectionSection } from "../features/settings/ConnectionSection";
import { InstallApp } from "../features/settings/InstallApp";
import { useUi, type Theme } from "../store/ui";
import { useIsDesktop } from "../lib/useMedia";
import { Label, Segmented } from "./ui/controls";
import { Sheet } from "./ui/Sheet";

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[14px]">
      <span className="text-text-2">{k}</span>
      <span className={ok === undefined ? "text-text" : ok ? "text-ok" : "text-danger"}>{v}</span>
    </div>
  );
}

/** The settings content: theme, connection (URLs + QR), install, account, and the setup check (spec 11.3). `open` = visible, so polling pauses when it is not. */
export function SettingsBody({ open }: { open: boolean }) {
  const theme = useUi((s) => s.theme);
  const set = useUi((s) => s.set);
  const { health, unreachable, refreshHealth } = useServer();
  const connected = useJobs((s) => s.connected);

  useEffect(() => {
    if (open) void refreshHealth();
  }, [open, refreshHealth]);

  return (
      <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:space-y-0 lg:[&>*]:mb-5">
        <div>
          <Label>Theme</Label>
          <div className="mt-1.5">
            <Segmented<Theme> label="Theme" value={theme} options={THEMES} onChange={(t) => set({ theme: t })} />
          </div>
        </div>
        <ConnectionSection open={open} />
        <InstallApp />
        <AccountSection />
        <div className="divide-y divide-line rounded-m border border-line px-3">
          <Row k="Accio server" v={unreachable ? "Unreachable" : "Running"} ok={!unreachable} />
          <Row k="Live updates" v={connected ? "Connected" : "Reconnecting…"} ok={connected} />
          <Row
            k="Backend server"
            v={!health ? "Checking…" : health.comfy_online ? "Online" : "Offline"}
            ok={health ? health.comfy_online : undefined}
          />
          {health?.comfy_online && (
            <>
              <Row k="Required models" v={health.missing_models.length ? `${health.missing_models.length} missing` : "All found"} ok={!health.missing_models.length} />
              <Row k="Components" v={health.missing_nodes.length ? `${health.missing_nodes.length} missing` : "All found"} ok={!health.missing_nodes.length} />
            </>
          )}
        </div>
        {health && health.missing_models.length > 0 && (
          <div>
            <Label>Missing models</Label>
            <ul className="mt-1 space-y-1 font-mono text-[12px] text-text-2">
              {health.missing_models.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-text-3">Run Install.bat again to download them.</p>
          </div>
        )}
        {health && health.missing_nodes.length > 0 && (
          <div>
            <Label>Missing components</Label>
            <p className="mt-1 font-mono text-[12px] text-text-2">{health.missing_nodes.join(", ")}</p>
          </div>
        )}
        {health?.warnings.map((w) => (
          <p key={w} className="rounded-s border border-line p-3 text-[13px] text-text-2">
            {w}
          </p>
        ))}
        <button type="button" onClick={() => void refreshHealth()} className="hover-wash h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text">
          Check again
        </button>
      </div>
  );
}

/** Desktop: Settings as a modal. On mobile it is the fourth tab (MobileLayout), so the sheet never opens there. */
export function Settings() {
  const open = useUi((s) => s.settingsOpen);
  const set = useUi((s) => s.set);
  const desktop = useIsDesktop();
  return (
    <Sheet open={open && desktop} onClose={() => set({ settingsOpen: false })} title="Settings" desktopModalWidth={760}>
      <SettingsBody open={open && desktop} />
    </Sheet>
  );
}
