export type LoraMode = "create" | "edit";
export type LoraGroup = "create" | "edit" | "shared";

/** ComfyUI lists LoRAs relative to models/loras, with the OS path separator. */
const segments = (name: string) => name.split(/[\\/]/);

/** Top-level folder, or "" for a file sitting directly in models/loras. */
export const loraFolder = (name: string) => (segments(name).length > 1 ? segments(name)[0] : "");

/** krea2* and moss* (moss-image) folders are Create's; qwen* / flux* / *-edit folders (qwen2.1-edit, flux-klein9b-edit) are Edit's. */
export function loraGroup(name: string): LoraGroup {
  const top = loraFolder(name).toLowerCase();
  if (!top) return "shared";
  if (top.startsWith("krea2") || top.startsWith("moss")) return "create";
  if (/^(qwen|flux)/.test(top) || top.endsWith("-edit")) return "edit";
  return "shared";
}

export const loraLabel = (name: string) => {
  const file = segments(name).at(-1) ?? name;
  return file.replace(/\.safetensors$/i, "");
};

/** LoRAs offered in a mode: its own folder first, then shared/unsorted (recently used here sorted up). */
export function lorasForMode(all: string[], mode: LoraMode, lastMode: Record<string, LoraMode>) {
  const own = all.filter((n) => loraGroup(n) === mode).sort((a, b) => a.localeCompare(b));
  const shared = all
    .filter((n) => loraGroup(n) === "shared")
    .sort((a, b) => Number(lastMode[b] === mode) - Number(lastMode[a] === mode) || a.localeCompare(b));
  const byFolder = new Map<string, string[]>();
  for (const n of own) byFolder.set(loraFolder(n), [...(byFolder.get(loraFolder(n)) ?? []), n]);
  const folders = [...byFolder].map(([folder, names]) => ({ folder, names }));
  return { own, folders, shared };
}
