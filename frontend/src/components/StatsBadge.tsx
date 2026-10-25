import { Thermometer } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchLive, type SystemLive } from "../api/endpoints";

const POLL_MS = 3000;
const HOT_C = 80;
const FULL_PCT = 90; // a bar turns red from here
const gb = (mb: number, digits = 1) => (mb / 1024).toFixed(digits);

/**
 * Live load for the header: graphics card temperature, load and VRAM, plus CPU and RAM load. Polls only while this tab is
 * visible. Anything the PC can't report is left out, and with nothing to show the badge is not drawn. `compact` (phones)
 * keeps just temperature, graphics load and VRAM. `grid` (the Settings page on a phone) lays the bars out two to a row, with the
 * temperature beside the graphics load, so nothing wraps into a lonely last item.
 */
export function StatsBadge({ compact = false, grid = false, className = "" }: { compact?: boolean; grid?: boolean; className?: string }) {
  const [live, setLive] = useState<SystemLive | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      if (document.hidden) return;
      fetchLive()
        .then((l) => alive && setLive(l))
        .catch(() => alive && setLive(null));
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

  const gpu = live?.gpus[0];
  const temp = gpu?.temp ?? null;
  const items: { key: string; text: string; tip: string; hot?: boolean; pct?: number }[] = [];
  if (temp != null) items.push({ key: "temp", text: `${temp}°`, tip: `Graphics card temperature ${temp} °C`, hot: temp >= HOT_C });
  if (gpu?.util != null) items.push({ key: "gpu", text: `GPU ${gpu.util}%`, tip: `Graphics card load ${gpu.util}%`, pct: gpu.util });
  if (gpu?.vram_used_mb != null && gpu.vram_total_mb != null)
    items.push({
      key: "vram",
      text: compact ? `${gb(gpu.vram_used_mb)} GB` : `VRAM ${gb(gpu.vram_used_mb)}/${gb(gpu.vram_total_mb, 0)} GB`,
      tip: `Video memory used ${gb(gpu.vram_used_mb)} of ${gb(gpu.vram_total_mb)} GB`,
      pct: gpu.vram_total_mb > 0 ? Math.round((100 * gpu.vram_used_mb) / gpu.vram_total_mb) : undefined,
    });
  if (!compact && live?.cpu.percent != null) items.push({ key: "cpu", text: `CPU ${live.cpu.percent}%`, tip: `Processor load ${live.cpu.percent}%`, pct: live.cpu.percent });
  if (!compact && live?.ram) items.push({ key: "ram", text: `RAM ${live.ram.percent}%`, tip: `Memory used ${gb(live.ram.used_mb)} of ${gb(live.ram.total_mb)} GB (${live.ram.percent}%)`, pct: live.ram.percent });
  if (!items.length) return null;

  if (grid) {
    const temp = items.find((i) => i.key === "temp");
    const cells = items.filter((i) => i.key !== "temp");
    return (
      <span
        role="status"
        aria-label="System load"
        data-tip={items.map((i) => i.tip).join(" · ")}
        className={`grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-line-strong px-4 py-3 text-[12px] tabular-nums text-text-2 ${className}`}
      >
        {cells.map((i) => (
          <span key={i.key} className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2 whitespace-nowrap leading-none">
              <span>{i.text}</span>
              {i.key === "gpu" && temp && (
                <span className={`inline-flex items-center gap-0.5 ${temp.hot ? "text-danger" : "text-text-3"}`}>
                  <Thermometer size={12} strokeWidth={1.8} aria-hidden />
                  {temp.text}
                </span>
              )}
            </span>
            {i.pct != null && <Bar pct={i.pct} />}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label="System load"
      data-tip={items.map((i) => i.tip).join(" · ")}
      className={`inline-flex h-8 flex-none items-center gap-2 whitespace-nowrap rounded-full border border-line-strong px-2.5 text-[12px] tabular-nums text-text-2 ${className}`}
    >
      {items.map((i) =>
        i.key === "temp" ? (
          <span key={i.key} className={`inline-flex items-center gap-1 ${i.hot ? "text-danger" : ""}`}>
            <Thermometer size={14} strokeWidth={1.8} aria-hidden />
            {i.text}
          </span>
        ) : (
          <span key={i.key} className="flex flex-col gap-[3px]">
            <span className="leading-none">{i.text}</span>
            {i.pct != null && <Bar pct={i.pct} />}
          </span>
        ),
      )}
    </span>
  );
}

/** A thin fill bar under a stat: gold, red when nearly full. */
function Bar({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <span className="block h-[3px] w-full overflow-hidden rounded-full bg-track" aria-hidden>
      <span className={`block h-full rounded-full transition-[width] duration-500 ${v >= FULL_PCT ? "bg-danger" : "bg-gold-ui"}`} style={{ width: `${v}%` }} />
    </span>
  );
}
