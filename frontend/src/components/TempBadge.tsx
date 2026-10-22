import { Thermometer } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchTemps, type SystemTemps } from "../api/endpoints";

const POLL_MS = 5000;
const HOT_C = 80;

/** Small live GPU (and, when readable, CPU) temperature for the header. Polls only while this tab is visible; shows nothing when no sensor can be read. */
export function TempBadge({ className = "" }: { className?: string }) {
  const [temps, setTemps] = useState<SystemTemps | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      if (document.hidden) return;
      fetchTemps()
        .then((t) => alive && setTemps(t))
        .catch(() => alive && setTemps(null));
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  const gpu = temps?.gpus.find((c): c is number => c != null);
  const cpu = temps?.cpu ?? null;
  if (gpu == null && cpu == null) return null;
  const hot = Math.max(gpu ?? 0, cpu ?? 0) >= HOT_C;
  return (
    <span
      role="status"
      data-tip={`Graphics card ${gpu ?? "unavailable"}${gpu != null ? " °C" : ""}${cpu != null ? ` · CPU ${cpu} °C` : ""}`}
      className={`inline-flex h-8 flex-none items-center gap-1.5 rounded-full border px-2.5 text-[12px] tabular-nums ${hot ? "border-danger/50 text-danger" : "border-line-strong text-text-2"} ${className}`}
    >
      <Thermometer size={14} strokeWidth={1.8} aria-hidden />
      {gpu != null && <span>GPU {gpu}°</span>}
      {cpu != null && <span>CPU {cpu}°</span>}
    </span>
  );
}
