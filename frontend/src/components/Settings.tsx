import { useEffect } from "react";
import { useServer } from "../store/health";
import { useJobs } from "../store/jobs";
import { AccountSection } from "../features/settings/AccountSection";
import { ConnectionSection } from "../features/settings/ConnectionSection";
import { InstallApp } from "../features/settings/InstallApp";
import { ModelFoldersSection } from "../features/settings/ModelFoldersSection";
import { SystemSection } from "../features/settings/SystemSection";
import { UpdateSection } from "../features/settings/UpdateSection";
import { useUi, type Theme } from "../store/ui";
import { useIsDesktop } from "../lib/useMedia";
import { playSound } from "../lib/notify";
import { SOUNDS } from "../lib/sounds";
import { Label, Segmented, Toggle, inputCls } from "./ui/controls";
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
  const notifyOnDone = useUi((s) => s.notifyOnDone);
  const notifySound = useUi((s) => s.notifySound);
  const set = useUi((s) => s.set);
  const { health, unreachable, refreshHealth } = useServer();
  const connected = useJobs((s) => s.connected);

  useEffect(() => {
    if (open) void refreshHealth();
  }, [open, refreshHealth]);

  // Mobile: one stack in `order-N` sequence. Desktop: two independent columns (wrappers become flex columns), so a tall card on one side leaves no gap on the other.
  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8">
      <div className="contents lg:flex lg:flex-col lg:gap-5">
        <div className="order-1">
          <Label>Theme</Label>
          <div className="mt-1.5">
            <Segmented<Theme> label="Theme" value={theme} options={THEMES} onChange={(t) => set({ theme: t })} />
          </div>
          <div className="mt-2">
            <Toggle
              on={notifyOnDone}
              onChange={(on) => set({ notifyOnDone: on })}
              label="Sound when finished"
              sub="Plays a chime when an image is ready, even if this tab is in the background"
            />
            {notifyOnDone && (
              <div className="mt-1 flex gap-2">
                <select
                  aria-label="Finish sound"
                  value={notifySound}
                  onChange={(e) => {
                    set({ notifySound: e.target.value });
                    playSound(e.target.value);
                  }}
                  className={inputCls}
                >
                  {SOUNDS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => playSound(notifySound)} className="h-11 flex-none rounded-s border border-line px-4 text-[14px] text-text-2">
                  Play
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="order-3">
          <InstallApp />
        </div>
        <div className="order-5">
          <AccountSection />
        </div>
        <div className="order-6 divide-y divide-line rounded-m border border-line px-3">
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
          <div className="order-7">
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
          <div className="order-8">
            <Label>Missing components</Label>
            <p className="mt-1 font-mono text-[12px] text-text-2">{health.missing_nodes.join(", ")}</p>
          </div>
        )}
        {health?.warnings.map((w) => (
          <p key={w} className="order-9 rounded-s border border-line p-3 text-[13px] text-text-2">
            {w}
          </p>
        ))}
      </div>
      <div className="contents lg:flex lg:flex-col lg:gap-5">
        <div className="order-2">
          <ConnectionSection open={open} />
        </div>
        <div className="order-4">
          <UpdateSection open={open} />
        </div>
        <div className="order-5">
          <SystemSection open={open} />
        </div>
      </div>
      <div className="order-10 lg:col-span-2">
        <ModelFoldersSection open={open} />
      </div>
    </div>
  );
}

/** Desktop: Settings as a modal. On mobile it is the fourth tab (MobileLayout), so the sheet never opens there. */
export function Settings() {
  const open = useUi((s) => s.settingsOpen);
  const set = useUi((s) => s.set);
  const desktop = useIsDesktop();
  return (
    <Sheet open={open && desktop} onClose={() => set({ settingsOpen: false })} title="Settings" desktopModalWidth={1200}>
      <SettingsBody open={open && desktop} />
    </Sheet>
  );
}
