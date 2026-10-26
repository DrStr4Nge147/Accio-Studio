import type { ModelRow, ModelsData } from "../api/endpoints";

/** Decimal units, like the sizes on the download pages (a 13.5 GB file shows as 13.5 GB). */
export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export interface ModelGroup {
  id: string;
  title: string;
  hint: string;
  rows: ModelRow[];
}

const GROUPS: { id: string; title: string; hint: string; has: (m: ModelRow) => boolean }[] = [
  { id: "required", title: "Required", hint: "Create, Edit and Outpaint need these.", has: (m) => m.required },
  {
    id: "klein",
    title: "Flux2 Klein 9B (optional)",
    hint: "A second Edit model that does Multi-edit with up to 3 images. Pick it in Edit > Advanced > Model.",
    has: (m) => !m.required && m.group === "klein",
  },
  {
    id: "moss",
    title: "MOSS Image (optional)",
    hint: "A second Create model (8 steps, with an optional sharpen). Pick it in Create > Mode.",
    has: (m) => !m.required && m.group === "moss",
  },
  { id: "presets", title: "Preset LoRAs (optional)", hint: "Head swap, body swap, remove object and move object.", has: (m) => !m.required && !m.group },
];

/** The models sorted into the cards the page shows; a group with nothing in it is left out. */
export function groupModels(rows: ModelRow[]): ModelGroup[] {
  return GROUPS.map((g) => ({ id: g.id, title: g.title, hint: g.hint, rows: rows.filter(g.has) })).filter((g) => g.rows.length > 0);
}

export const isHave = (m: ModelRow) => m.state === "installed" || m.state === "linked";

/** The ids still to download (everything not installed and not already on its way). */
export function missingIds(rows: ModelRow[]): string[] {
  return rows.filter((m) => !isHave(m) && m.state !== "downloading" && m.state !== "queued").map((m) => m.id);
}

/** Percent of the file on disk, or null when nothing is partly there. */
export function percent(m: ModelRow): number | null {
  if (m.state !== "downloading" && m.state !== "partial") return null;
  return Math.min(100, Math.floor((m.bytes / m.size) * 100));
}

export function stateText(m: ModelRow): string {
  switch (m.state) {
    case "installed":
      return "Installed";
    case "linked":
      return "Found in your model folders";
    case "downloading":
      return `Downloading ${percent(m) ?? 0}%`;
    case "queued":
      return "Waiting";
    case "partial":
      return `Paused at ${percent(m) ?? 0}%`;
    case "damaged":
      return "Damaged, download again";
    default:
      return "Not downloaded";
  }
}

/** One line for the top of the section: how many required models are still missing. */
export function summary(data: ModelsData): string {
  const need = data.models.filter((m) => m.required && !isHave(m));
  if (!need.length) return "All required models are installed.";
  const bytes = need.reduce((n, m) => n + m.size - (m.state === "partial" || m.state === "downloading" ? m.bytes : 0), 0);
  return `${need.length} required model${need.length === 1 ? " is" : "s are"} missing (${formatSize(bytes)} to download).`;
}
