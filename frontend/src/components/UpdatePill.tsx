import { ArrowUpCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchUpdate } from "../api/endpoints";
import { openSettings } from "../store/ui";

const RECHECK_MS = 3600_000; // the server answers from its own 6 h cache, so this never adds GitHub requests

/** Small "Update" pill for the header when a newer release exists. Opens Settings, where "Update now" is. Not dismissible on purpose. */
export function UpdatePill({ label = "Update", className = "" }: { label?: string; className?: string }) {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      fetchUpdate(false)
        .then((i) => setLatest(i.enabled && i.available ? i.latest : null))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, RECHECK_MS);
    return () => window.clearInterval(t);
  }, []);

  if (!latest) return null;
  return (
    <button
      type="button"
      onClick={openSettings}
      aria-label={`Update ${latest} is available`}
      data-tip={`Version ${latest} is available`}
      className={`inline-flex h-8 flex-none items-center gap-1.5 rounded-full bg-gold-wash px-3 text-[12px] font-semibold text-gold-text ${className}`}
    >
      <ArrowUpCircle size={15} strokeWidth={2} />
      {label}
    </button>
  );
}
