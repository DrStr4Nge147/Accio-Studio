import { useSyncExternalStore } from "react";

/** The browser's install prompt, captured as early as it fires (it can arrive before any UI exists). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  installed = true;
  notify();
});

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export type InstallState = "installed" | "prompt" | "ios" | "insecure" | "unavailable";

/** What the settings page should offer: a real install button, iOS steps, or why installing is not possible here. */
export function installState(canPrompt: boolean, wasInstalled: boolean): InstallState {
  if (wasInstalled || isStandalone()) return "installed";
  if (canPrompt) return "prompt";
  if (!window.isSecureContext) return "insecure";
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "ios";
  return "unavailable";
}

export function usePwaInstall() {
  const snapshot = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => `${deferred ? 1 : 0}${installed ? 1 : 0}`,
  );
  return {
    state: installState(snapshot[0] === "1", snapshot[1] === "1"),
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      notify();
    },
  };
}
