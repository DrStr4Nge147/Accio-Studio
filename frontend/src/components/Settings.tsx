import { useEffect, useState, type ComponentType } from "react";
import { Cpu, Globe, Package, Palette, UserRound } from "lucide-react";
import { useServer } from "../store/health";
import { AccountSection } from "../features/settings/AccountSection";
import { AppearanceSection } from "../features/settings/AppearanceSection";
import { ConnectionSection } from "../features/settings/ConnectionSection";
import { InstallApp } from "../features/settings/InstallApp";
import { ModelFoldersSection } from "../features/settings/ModelFoldersSection";
import { ModelsSection } from "../features/settings/ModelsSection";
import { StatusSection } from "../features/settings/StatusSection";
import { SystemSection } from "../features/settings/SystemSection";
import { UploadsSection } from "../features/settings/UploadsSection";
import { UpdateSection } from "../features/settings/UpdateSection";
import { useUi } from "../store/ui";
import { useIsDesktop } from "../lib/useMedia";
import { SettingsCard } from "./ui/SettingsCard";
import { Sheet } from "./ui/Sheet";

/** Mobile: the settings content as one stack, in `order-N` sequence (the fourth tab, MobileLayout). `open` = visible, so polling pauses when it is not. */
export function SettingsBody({ open }: { open: boolean }) {
  const { refreshHealth } = useServer();

  useEffect(() => {
    if (open) void refreshHealth();
  }, [open, refreshHealth]);

  return (
    <div className="flex flex-col gap-5">
      <div className="order-1">
        <AppearanceSection />
      </div>
      <div className="order-2">
        <ConnectionSection open={open} />
      </div>
      <div className="order-3">
        <InstallApp />
      </div>
      <div className="order-4">
        <UpdateSection open={open} />
      </div>
      <div className="order-5">
        <AccountSection />
      </div>
      <div className="order-5">
        <SystemSection open={open} />
      </div>
      <div className="order-6">
        <StatusSection />
      </div>
      <div className="order-6">
        <UploadsSection />
      </div>
      <div className="order-9">
        <ModelsSection open={open} />
      </div>
      <div className="order-10">
        <ModelFoldersSection open={open} />
      </div>
    </div>
  );
}

type TabId = "general" | "models" | "connection" | "system" | "account";

const TABS: { id: TabId; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: "general", label: "General", icon: Palette },
  { id: "models", label: "Models", icon: Package },
  { id: "connection", label: "Connection", icon: Globe },
  { id: "system", label: "System", icon: Cpu },
  { id: "account", label: "Account", icon: UserRound },
];

/** Desktop: a category list on the left, the chosen category's cards on the right. The size stays fixed so switching never makes the window jump. */
function SettingsDesktop({ open }: { open: boolean }) {
  const [tab, setTab] = useState<TabId>("general");
  const { health, refreshHealth } = useServer();

  useEffect(() => {
    if (open) void refreshHealth();
  }, [open, refreshHealth]);

  // Opened from the "models are missing" banner: land where they can be downloaded.
  const missing = !!health?.missing_models.length;
  useEffect(() => {
    if (open && missing) setTab("models");
    // only when the window opens (or first learns models are missing), not on every health refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, missing]);

  return (
    <div className="flex h-[min(720px,calc(92vh-80px))] min-h-0">
      <nav aria-label="Settings sections" className="flex w-52 flex-none flex-col gap-0.5 border-r border-line px-3 py-4">
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => setTab(id)}
              className={`relative flex h-10 items-center gap-3 rounded-s px-3 text-left text-[14px] transition-colors ${
                on ? "bg-overlay font-medium text-text" : "text-text-2 hover:bg-overlay/60 hover:text-text"
              }`}
            >
              {on && <i className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-gold-ui" aria-hidden />}
              <Icon size={17} strokeWidth={1.7} />
              <span className="flex-1">{label}</span>
              {id === "models" && missing && <i className="h-2 w-2 rounded-full bg-danger" aria-label="Models missing" />}
            </button>
          );
        })}
      </nav>
      <div role="region" aria-label={TABS.find((t) => t.id === tab)?.label} className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
        <div className="mx-auto flex max-w-[860px] flex-col gap-4">
          {tab === "general" && (
            <>
              <SettingsCard title="Appearance" description="Theme and the sound that tells you an image is ready.">
                <AppearanceSection />
              </SettingsCard>
              <SettingsCard title="Install as an app" description="Open Accio in its own window, like any other app.">
                <InstallApp />
              </SettingsCard>
              <SettingsCard title="Uploads" description="Free disk space used by images you uploaded for editing.">
                <UploadsSection />
              </SettingsCard>
            </>
          )}
          {tab === "models" && (
            <>
              <SettingsCard title="Models" description="Download the files Accio needs. They are checked when they finish.">
                <ModelsSection open={open} />
              </SettingsCard>
              <SettingsCard title="Model folders">
                <ModelFoldersSection open={open} />
              </SettingsCard>
            </>
          )}
          {tab === "connection" && (
            <SettingsCard title="Connection" description="Where Accio can be reached, and a QR code to open it on a phone.">
              <ConnectionSection open={open} />
            </SettingsCard>
          )}
          {tab === "system" && (
            <>
              <SettingsCard title="Status" description="What Accio needs to run.">
                <StatusSection onManageModels={() => setTab("models")} />
              </SettingsCard>
              <SettingsCard title="This PC" description="Graphics card, driver and memory.">
                <SystemSection open={open} />
              </SettingsCard>
              <SettingsCard title="Updates">
                <UpdateSection open={open} />
              </SettingsCard>
            </>
          )}
          {tab === "account" && (
            <SettingsCard title="Account" description="Change your password or sign out on this device.">
              <AccountSection />
            </SettingsCard>
          )}
        </div>
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
    <Sheet open={open && desktop} onClose={() => set({ settingsOpen: false })} title="Settings" desktopModalWidth={1100} flush>
      <SettingsDesktop open={open && desktop} />
    </Sheet>
  );
}
