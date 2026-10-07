import { useEffect, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { IconButton, Segmented, Slider, Toggle } from "./ui/controls";
import { loraLabel, lorasForMode } from "../lib/loras";
import { useServer } from "../store/health";
import type { LoraMode } from "../lib/loras";

export type LoraTarget = "both" | "pass1" | "pass2";
export interface LoraSel {
  name: string;
  strength: number;
  on: boolean;
  target: LoraTarget;
}

/**
 * Stackable, collapsible LoRA picker shared by Create and Edit. Files in the mode's own folder come first, then
 * shared / unsorted (spec 6.6). `passes` adds the per-pass target selector (Create > Detailed only).
 */
export function LoraList({
  mode,
  loras,
  loraLastMode,
  onChange,
  passes,
}: {
  mode: LoraMode;
  loras: LoraSel[];
  loraLastMode: Record<string, LoraMode>;
  onChange: (loras: LoraSel[]) => void;
  passes?: boolean;
}) {
  const catalog = useServer((s) => s.catalog);
  const refreshCatalog = useServer((s) => s.refreshCatalog);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  // The picker lists LoRAs fresh from ComfyUI every time it opens.
  useEffect(() => {
    if (adding) void refreshCatalog();
  }, [adding, refreshCatalog]);

  const update = (i: number, p: Partial<LoraSel>) => onChange(loras.map((l, n) => (n === i ? { ...l, ...p } : l)));
  const { own, shared } = lorasForMode(catalog?.loras ?? [], mode, loraLastMode);
  const taken = new Set(loras.map((l) => l.name));
  const add = (name: string) => {
    onChange([...loras, { name, strength: 1, on: true, target: "both" }]);
    setAdding(false);
  };

  return (
    <div className="rounded-m border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="hover-wash flex h-12 w-full items-center justify-between rounded-m px-3 text-[14px] text-text-2 hover:text-text"
      >
        <span>LoRAs</span>
        <span className="flex items-center gap-1 text-[12px] text-text-3">
          {loras.length ? `${loras.filter((l) => l.on).length} on` : "none"}
          <ChevronDown size={16} strokeWidth={1.7} className={open ? "rotate-180" : ""} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3">
          {loras.map((l, i) => (
            <div key={`${l.name}-${i}`} className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Toggle on={l.on} onChange={(on) => update(i, { on })} label={loraLabel(l.name)} />
                </div>
                <IconButton label={`Remove ${loraLabel(l.name)}`} onClick={() => onChange(loras.filter((_, n) => n !== i))}>
                  <X size={18} strokeWidth={1.7} />
                </IconButton>
              </div>
              <Slider
                label="Strength"
                min={-2}
                max={2}
                step={0.05}
                value={l.strength}
                disabled={!l.on}
                onChange={(strength) => update(i, { strength })}
              />
              {passes && (
                <Segmented<LoraTarget>
                  small
                  label="Apply to"
                  value={l.target}
                  onChange={(target) => update(i, { target })}
                  options={[
                    { value: "both", label: "Both passes" },
                    { value: "pass1", label: "Pass 1" },
                    { value: "pass2", label: "Pass 2" },
                  ]}
                />
              )}
            </div>
          ))}
          {adding ? (
            <div className="rounded-s border border-line-strong bg-raised p-1" role="listbox" aria-label="Choose a LoRA">
              {[
                [mode === "create" ? "Krea2" : "Qwen", own],
                ["Shared / unsorted", shared],
              ].map(([title, names]) => {
                const list = (names as string[]).filter((n) => !taken.has(n));
                return (
                  list.length > 0 && (
                    <div key={title as string}>
                      <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-text-3">{title as string}</div>
                      {list.map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => add(n)}
                          className="block min-h-11 w-full rounded-lg px-2 text-left text-[14px] hover:bg-overlay hover:text-text"
                        >
                          {loraLabel(n)}
                        </button>
                      ))}
                    </div>
                  )
                );
              })}
              {!catalog && <p className="p-2 text-[13px] text-text-3">Couldn't load the LoRA list from the backend.</p>}
              {catalog && own.length + shared.length === taken.size && <p className="p-2 text-[13px] text-text-3">No more LoRAs to add.</p>}
              <button type="button" onClick={() => setAdding(false)} className="hover-wash h-11 w-full rounded-s text-[13px] text-text-2 hover:text-text">
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="hover-wash flex h-11 w-full items-center justify-center gap-1.5 rounded-s border border-dashed border-line-strong text-[13px] text-text-2 hover:border-text-3 hover:text-text"
            >
              <Plus size={16} strokeWidth={1.7} /> Add LoRA
            </button>
          )}
        </div>
      )}
    </div>
  );
}
