import { useEffect, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { IconButton, Segmented, Slider, Toggle } from "./ui/controls";
import { loraLabel, lorasForMode } from "../lib/loras";
import { splitWords, useTriggerWords } from "../lib/triggerWords";
import { useServer } from "../store/health";
import type { LoraMode } from "../lib/loras";

export type LoraTarget = "both" | "pass1" | "pass2";
export interface LoraSel {
  name: string;
  strength: number;
  on: boolean;
  target: LoraTarget;
}

/** Trigger words saved for a LoRA, shown as tags; typing `@` in the prompt box offers them. */
function TriggerField({ lora }: { lora: string }) {
  const words = useTriggerWords((s) => s.words[lora]) ?? [];
  const [draft, setDraft] = useState("");
  const save = (list: string[]) => useTriggerWords.getState().set(lora, list);
  // Commit whatever is typed (a pasted "a, b, c" becomes three tags)
  const commit = (text: string) => {
    const added = splitWords(text);
    if (added.length) save([...new Set([...words, ...added])]);
    setDraft("");
  };

  return (
    <div
      data-tip="Saved on this device. Type @ in the prompt box to insert these"
      className="mt-1 flex min-h-10 flex-wrap items-center gap-1.5 rounded-s border border-line bg-raised px-2 py-1.5 focus-within:border-gold"
    >
      {words.map((w) => (
        <span key={w} className="flex max-w-full items-center gap-1 rounded-full border border-gold/45 bg-gold-wash py-0.5 pl-2.5 pr-1 text-[12.5px] text-gold-text">
          <span className="truncate">{w}</span>
          <button type="button" aria-label={`Remove trigger word ${w}`} onClick={() => save(words.filter((x) => x !== w))} className="flex h-5 w-5 flex-none items-center justify-center rounded-full hover:bg-black/20">
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => (e.target.value.includes(",") ? commit(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && words.length) save(words.slice(0, -1));
        }}
        onBlur={() => commit(draft)}
        placeholder={words.length ? "Add another" : "Trigger words: type one, press Enter or comma"}
        aria-label={`Trigger words for ${loraLabel(lora)}`}
        maxLength={120}
        className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-[13px] text-text outline-none placeholder:text-text-3"
      />
    </div>
  );
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
  const { own, folders, shared } = lorasForMode(catalog?.loras ?? [], mode, loraLastMode);
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
                min={-10}
                max={10}
                step={0.05}
                value={l.strength}
                disabled={!l.on}
                onChange={(strength) => update(i, { strength })}
              />
              <TriggerField lora={l.name} />
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
              {[...folders.map((f) => [f.folder, f.names] as const), ["Shared / unsorted", shared] as const]
                .map(([title, names]) => ({ title, list: names.filter((n) => !taken.has(n)) }))
                .filter((g) => g.list.length > 0)
                .map(({ title, list }, gi) => (
                  <div key={title} className={gi > 0 ? "mt-2 border-t border-line pt-1" : ""}>
                    <div className="flex items-center justify-between px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-text-3">
                      <span>{title}</span>
                      <span className="font-normal normal-case tracking-normal">{list.length}</span>
                    </div>
                    {list.map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="option"
                        aria-selected={false}
                        title={loraLabel(n)}
                        onClick={() => add(n)}
                        className="block min-h-11 w-full rounded-lg px-2 text-left text-[14px] hover:bg-overlay hover:text-text"
                      >
                        <span className="block truncate">{loraLabel(n)}</span>
                      </button>
                    ))}
                  </div>
                ))}
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
