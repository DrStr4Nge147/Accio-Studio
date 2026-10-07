import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Chip, IconButton, Label, Segmented, Toggle } from "../../components/ui/controls";
import { useUi } from "../../store/ui";
import { AspectPicker } from "./AspectPicker";
import { CreateAdvanced } from "./CreateAdvanced";
import { useCreate, type Variant } from "./store";

const BATCHES = [1, 2, 4];
const next = <T,>(list: T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length]!;
const VARIANTS: { value: Variant; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
];

/** Mobile main controls: one scrolling row of chips; aspect and everything else open the Advanced sheet. */
export function CreateChips() {
  const s = useCreate();
  const size = s.sizes[s.variant];
  const openAdvanced = () => useUi.getState().set({ advancedOpen: true });
  return (
    <div className="no-scrollbar -mx-3.5 flex items-center gap-1.5 overflow-x-auto px-3.5 py-1">
      <IconButton label="Advanced settings" onClick={openAdvanced} className="-ml-2 border border-line-strong">
        <SlidersHorizontal size={18} strokeWidth={1.7} />
      </IconButton>
      <Chip toggle={false} onClick={() => s.patch({ variant: next(["standard", "detailed"] as Variant[], s.variant) })} label={`Mode: ${s.variant}. Tap to switch`}>
        {s.variant === "standard" ? "Standard" : "Detailed"}
      </Chip>
      <Chip toggle={false} onClick={openAdvanced} label="Aspect ratio">
        {size.aspect === "custom" ? `${size.w}×${size.h}` : size.aspect}
      </Chip>
      <Chip toggle={false} onClick={() => s.patch({ batch: next(BATCHES, s.batch) })} label={`Images per run: ${s.batch}. Tap to change`}>
        ×{s.batch}
      </Chip>
      <Chip on={s.seedVariance} onClick={() => s.patch({ seedVariance: !s.seedVariance })}>
        Variance
      </Chip>
      <Chip on={s.sharpen} onClick={() => s.patch({ sharpen: !s.sharpen })}>
        Sharpen
      </Chip>
      <Chip on={s.tEnhancer} onClick={() => s.patch({ tEnhancer: !s.tEnhancer })}>
        T-Enhancer
      </Chip>
    </div>
  );
}

/** Desktop main controls (left pane): toggles, with Advanced as an inline collapsible. */
export function CreateToggles() {
  const s = useCreate();
  const open = useUi((u) => u.advancedInline);
  return (
    <div className="space-y-3">
      <Segmented<Variant> label="Mode" value={s.variant} options={VARIANTS} onChange={(variant) => s.patch({ variant })} />
      <AspectPicker />
      <div>
        <Toggle on={s.seedVariance} onChange={(seedVariance) => s.patch({ seedVariance })} label="Seed variance" />
        <Toggle on={s.sharpen} onChange={(sharpen) => s.patch({ sharpen })} label="Sharpen" />
        <Toggle on={s.tEnhancer} onChange={(tEnhancer) => s.patch({ tEnhancer })} label="T-Enhancer" />
      </div>
      <div className="flex items-center justify-between">
        <Label>Images</Label>
        <Segmented small label="Images per run" value={s.batch} onChange={(batch) => s.patch({ batch })} options={BATCHES.map((n) => ({ value: n, label: String(n) }))} />
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => useUi.getState().set({ advancedInline: !open })}
        className="flex h-11 w-full items-center justify-between rounded-m border border-line px-3 text-[14px] text-text-2"
      >
        Advanced
        <ChevronDown size={18} strokeWidth={1.7} className={open ? "rotate-180" : ""} />
      </button>
      {open && <CreateAdvanced withAspect={false} />}
    </div>
  );
}
