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
import { useScrollFade } from "./ui/controls";
import { SettingsCard } from "./ui/SettingsCard";
import { Sheet } from "./ui/Sheet";

type TabId = "general" | "models" | "connection" | "system" | "account";

const TABS: { id: TabId; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: "general", label: "General", icon: Palette },
  { id: "models", label: "Models", icon: Package },
  { id: "connection", label: "Connection", icon: Globe },
  { id: "system", label: "System", icon: Cpu },
  { id: "account", label: "Account", icon: UserRound },
];

/** The chosen category, health refreshed while visible, and a jump to Models when the window opens with models missing. */
function useSettingsTabs(open: boolean) {
  const [tab, setTab] = useState<TabId>("general");
  const { health, refreshHealth } = useServer();

  useEffect(() => {
    if (open) void refreshHealth();
  }, [open, refreshHealth]);

  const missing = !!health?.missing_models.length;
  useEffect(() => {
    if (open && missing) setTab("models");
    // only when the window opens (or first learns models are missing), not on every health refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, missing]);

  return { tab, setTab, missing };
}

/** The cards of one category; the same on desktop and mobile. */
function SettingsPages({ tab, open, goModels }: { tab: TabId; open: boolean; goModels: () => void }) {
  return (
    <>
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
          <SettingsCard title="Updates">
            <UpdateSection open={open} />
          </SettingsCard>
          <SettingsCard title="Status" description="What Accio needs to run.">
            <StatusSection onManageModels={goModels} />
          </SettingsCard>
          <SettingsCard title="This PC" description="Graphics card, driver and memory.">
            <SystemSection open={open} />
          </SettingsCard>
        </>
      )}
      {tab === "account" && (
        <SettingsCard title="Account" description="Change your password or sign out on this device.">
          <AccountSection />
        </SettingsCard>
      )}
    </>
  );
}

/** Mobile (the fourth tab, MobileLayout): the same categories as a strip along the top that sticks while the cards scroll beneath it. */
export function SettingsBody({ open }: { open: boolean }) {
  const { tab, setTab, missing } = useSettingsTabs(open);
  const fade = useScrollFade<HTMLElement>(missing);
  return (
    <div>
      {/* Tabs share the width when they fit; on a narrow phone the strip scrolls, fades at the hidden edge and keeps the chosen tab in view. */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-line bg-bg">
        <nav ref={fade.ref} style={fade.style} aria-label="Settings sections" className="no-scrollbar flex overflow-x-auto px-3">
          {TABS.map(({ id, label }) => {
            const on = tab === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={(e) => {
                  setTab(id);
                  e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
                }}
                className={`relative flex h-11 min-w-max flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-1.5 text-[13px] transition-colors ${
                  on ? "font-medium text-text" : "text-text-3"
                }`}
              >
                {label}
                {id === "models" && missing && <i className="h-1.5 w-1.5 rounded-full bg-danger" aria-label="Models missing" />}
                {on && <i className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-gold-ui" aria-hidden />}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="mt-4 flex flex-col gap-4 pb-2">
        <SettingsPages tab={tab} open={open} goModels={() => setTab("models")} />
      </div>
    </div>
  );
}

/** Desktop: a category list on the left, the chosen category's cards on the right. The size stays fixed so switching never makes the window jump. */
function SettingsDesktop({ open }: { open: boolean }) {
  const { tab, setTab, missing } = useSettingsTabs(open);
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
          <SettingsPages tab={tab} open={open} goModels={() => setTab("models")} />
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
