import { ChevronDown, Info, SlidersHorizontal } from "lucide-react";
import { Chip, ChipRow, Label, Segmented, Toggle } from "../../components/ui/controls";
import { useUi } from "../../store/ui";
import { AspectPicker } from "./AspectPicker";
import { CreateAdvanced } from "./CreateAdvanced";
import { PromptToolsChip } from "./PromptToolsChip";
import { TIPS } from "./tips";
import { useCreate, type Variant } from "./store";

const BATCHES = [1, 2, 4];
const next = <T,>(list: T[], cur: T) => list[(list.indexOf(cur) + 1) % list.length]!;
const VARIANTS: { value: Variant; label: string; tip: string }[] = [
  { value: "standard", label: "Standard", tip: TIPS.standard },
  { value: "detailed", label: "Detailed", tip: TIPS.detailed },
];

/** Shown while Detailed is selected: the second pass re-samples the first image, which can amplify flaws. */
export function DetailedNote({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-text-3">
        <Info size={14} strokeWidth={1.7} className="mt-px flex-none" aria-hidden />
        Two passes: slower, and artifacts can build up. Check the first-pass image if the result looks off.
      </p>
    );
  }
  return (
    <div role="note" className="flex gap-2 rounded-s border border-line bg-raised px-3 py-2.5 text-[12.5px] leading-snug text-text-2">
      <Info size={16} strokeWidth={1.7} className="mt-0.5 flex-none text-gold-text" aria-hidden />
      <span>
        Detailed refines the first image with a second pass, so it takes longer and artifacts can build up. If the result looks off, compare it
        with the first-pass image or lower the refine denoise in Advanced.
      </span>
    </div>
  );
}

/** Opens the mobile Options (Advanced) sheet. Pinned after the scrolling chips; just the icon on narrow phones. */
export function OptionsChip() {
  return (
    <Chip toggle={false} onClick={() => useUi.getState().set({ advancedOpen: true })} label="Options" tip="Finishing toggles, aspect, sampler and more">
      <SlidersHorizontal size={16} strokeWidth={1.7} />
      <span className="max-[399px]:hidden">Options</span>
    </Chip>
  );
}

/** Mobile main controls: mode, aspect, count and Options; everything else lives in the Options sheet. */
export function CreateChips() {
  const s = useCreate();
  const size = s.sizes[s.variant];
  const openAdvanced = () => useUi.getState().set({ advancedOpen: true });
  return (
    <>
    <ChipRow end={<OptionsChip />}>
      <Chip toggle={false} onClick={() => s.patch({ variant: next(["standard", "detailed"] as Variant[], s.variant) })} label={`Mode: ${s.variant}. Tap to switch`} tip={s.variant === "standard" ? TIPS.standard : TIPS.detailed}>
        {s.variant === "standard" ? "Standard" : "Detailed"}
      </Chip>
      <PromptToolsChip />
      <Chip toggle={false} onClick={openAdvanced} label="Aspect ratio" tip="Pick an aspect ratio or a custom size in Advanced">
        {size.aspect === "custom" ? `${size.w}×${size.h}` : size.aspect}
      </Chip>
      <Chip toggle={false} onClick={() => s.patch({ batch: next(BATCHES, s.batch) })} label={`Images per run: ${s.batch}. Tap to change`} tip={TIPS.batch}>
        ×{s.batch}
      </Chip>
    </ChipRow>
    {s.variant === "detailed" && <DetailedNote compact />}
    </>
  );
}

/** Desktop main controls (left pane): toggles, with Advanced as an inline collapsible. */
export function CreateToggles() {
  const s = useCreate();
  const open = useUi((u) => u.advancedInline);
  return (
    <div className="space-y-3">
      <Segmented<Variant> label="Mode" value={s.variant} options={VARIANTS} onChange={(variant) => s.patch({ variant })} />
      {s.variant === "detailed" && <DetailedNote />}
      <AspectPicker />
      <div>
        <Toggle on={s.seedVariance} onChange={(seedVariance) => s.patch({ seedVariance })} label="Seed variance" tip={TIPS.seedVariance} />
        <Toggle on={s.sharpen} onChange={(sharpen) => s.patch({ sharpen })} label="Sharpen" tip={TIPS.sharpen} />
        <Toggle on={s.tEnhancer} onChange={(tEnhancer) => s.patch({ tEnhancer })} label="T-Enhancer" tip={TIPS.tEnhancer} />
      </div>
      <div className="flex items-center justify-between">
        <Label tip={TIPS.batch}>Images</Label>
        <Segmented small label="Images per run" value={s.batch} onChange={(batch) => s.patch({ batch })} options={BATCHES.map((n) => ({ value: n, label: String(n) }))} />
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => useUi.getState().set({ advancedInline: !open })}
        className="hover-wash flex h-11 w-full items-center justify-between rounded-m border border-line px-3 text-[14px] text-text-2 transition-colors hover:border-line-strong hover:text-text"
      >
        Advanced
        <ChevronDown size={18} strokeWidth={1.7} className={open ? "rotate-180" : ""} />
      </button>
      {open && <CreateAdvanced withAspect={false} />}
    </div>
  );
}
