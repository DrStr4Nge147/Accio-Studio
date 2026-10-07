import { useSyncExternalStore } from "react";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

/** The layouts are designed separately: desktop at >= 1024 px (APP_SPEC 6.2). */
export const useIsDesktop = () => useMedia("(min-width: 1024px)");
