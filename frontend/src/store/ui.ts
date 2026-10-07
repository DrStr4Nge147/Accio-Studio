import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light" | "system";
export type Tab = "create" | "edit" | "gallery" | "settings";

interface UiState {
  theme: Theme;
  tab: Tab;
  settingsOpen: boolean;
  /** Mobile Advanced sheet (desktop uses an inline collapsible instead). */
  advancedOpen: boolean;
  /** Desktop inline Advanced section. */
  advancedInline: boolean;
  /** Desktop console drawer open; on mobile the console sheet. */
  consoleOpen: boolean;
  /** Mobile: the job opened full screen from the feed. */
  viewerOpen: boolean;
  /** Mobile Inpaint: the mask is being painted on a full-screen canvas (Next goes on to the prompt). */
  maskFullscreen: boolean;
  /** Edit modes whose prompt box is unfolded (Outpaint and Inpaint start folded). */
  promptOpen: Record<string, boolean>;
  set: (patch: Partial<Omit<UiState, "set">>) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      tab: "create",
      settingsOpen: false,
      advancedOpen: false,
      advancedInline: false,
      consoleOpen: false,
      viewerOpen: false,
      maskFullscreen: false,
      promptOpen: {},
      set: (patch) => set(patch),
    }),
    {
      name: "accio.ui",
      version: 1,
      partialize: (s) => ({ theme: s.theme, tab: s.tab === "settings" ? "create" : s.tab, advancedInline: s.advancedInline, consoleOpen: s.consoleOpen }),
    },
  ),
);

const dark = window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? (dark.matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#0b0a0f" : "#f3f4fa");
}

/** Keep <html data-theme> in sync with the stored choice and the OS setting. Call once at startup. */
export function watchTheme() {
  applyTheme(useUi.getState().theme);
  useUi.subscribe((s, prev) => s.theme !== prev.theme && applyTheme(s.theme));
  dark.addEventListener("change", () => applyTheme(useUi.getState().theme));
}

/** Settings is a modal on desktop and the fourth tab on mobile. */
export function openSettings() {
  if (window.matchMedia("(min-width: 1024px)").matches) useUi.getState().set({ settingsOpen: true });
  else useUi.getState().set({ tab: "settings" });
}
