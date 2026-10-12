import type { SystemInfo } from "../api/endpoints";

/** Comfortable megapixels per image by graphics-card memory (GB, upper bound -> MP). Rough: the models offload to RAM, so these are soft limits. */
const VRAM_MP: [number, number][] = [
  [4, 1],
  [6, 2.5],
  [8, 3.5],
  [12, 5],
  [16, 7],
  [24, 10],
];
const LOW_RAM_MB = 16 * 1024;
/** Past this multiple of the comfortable size the wording changes from "may be slow" to "likely to run out of memory". */
const EXTREME = 1.6;

export interface LoadHint {
  level: "heavy" | "extreme";
  text: string;
}

/** Comfortable size in MP for this PC, or null when the card's memory is unknown (AMD/Intel/no driver: say nothing). */
export function comfortableMp(sys: SystemInfo | null): number | null {
  const vram = sys?.gpus[0]?.vram_mb;
  if (!sys || !vram) return null;
  const gb = vram / 1024;
  const base = VRAM_MP.find(([max]) => gb <= max + 0.5)?.[1] ?? Infinity;
  const k = sys.ram_mb && sys.ram_mb < LOW_RAM_MB ? 0.75 : 1;
  return base * k;
}

/** A gentle heads-up when `mp` is more than this PC handles comfortably; never blocks anything. `what` names the thing, e.g. "This size". */
export function loadHint(sys: SystemInfo | null, mp: number, what = "This size"): LoadHint | null {
  const limit = comfortableMp(sys);
  if (limit === null || !(mp > limit)) return null;
  const card = `${sys!.gpus[0]!.name.replace(/^NVIDIA\s+(GeForce\s+)?/i, "")} (${Math.round(sys!.gpus[0]!.vram_mb! / 1024)} GB)`;
  const around = `Around ${limit.toFixed(1)} MP or less is comfortable.`;
  if (mp > limit * EXTREME) return { level: "extreme", text: `${what} (${mp.toFixed(1)} MP) is very large for your ${card} and will likely run out of memory. ${around}` };
  return { level: "heavy", text: `${what} (${mp.toFixed(1)} MP) is a lot for your ${card}: it may be slow or run out of memory. ${around}` };
}
