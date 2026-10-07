export type LoraMode = "create" | "edit";
export type LoraGroup = "create" | "edit" | "shared";

/** ComfyUI lists LoRAs relative to models/loras, with the OS path separator. */
const segments = (name: string) => name.split(/[\\/]/);

export function loraGroup(name: string): LoraGroup {
  const top = segments(name)[0]?.toLowerCase();
  if (segments(name).length > 1 && top === "krea2") return "create";
  if (segments(name).length > 1 && top === "qwen") return "edit";
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
  return { own, shared };
}
