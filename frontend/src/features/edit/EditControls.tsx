import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Chip, IconButton, Label, Segmented, Toggle } from "../../components/ui/controls";
import { useUi } from "../../store/ui";
import { selectEditMode, togglePreset } from "./actions";
import { EditAdvanced } from "./EditAdvanced";
import { PaddingFields } from "./PaddingFields";
import { INPAINT_PRESETS, MULTI_PRESETS, PRESETS, type PresetId } from "./presets";
import { EDIT_MODES, useEdit, type EditMode, type FillMode } from "./store";
import { EDIT_TIPS as T } from "./tips";

const FILL_CYCLE: { value: FillMode; label: string }[] = [
  { value: "color", label: "Solid colour" },
  { value: "edge", label: "Stretch edge" },
  { value: "edge pixel", label: "Edge pixel" },
  { value: "pillarbox blur", label: "Blurred backdrop" },
  { value: "mirror", label: "Mirror" },
];

/** Multi-edit / Inpaint / Outpaint switch (desktop: top of the controls pane; mobile: under the header). */
export function EditModeSwitch({ stretch }: { stretch?: boolean }) {
  const mode = useEdit((s) => s.mode);
  const seg = <Segmented<EditMode> label="Edit mode" value={mode} onChange={selectEditMode} options={EDIT_MODES.map((m) => ({ value: m.value, label: stretch ? m.short : m.label }))} />;
  return stretch ? <div className="[&>div]:flex [&>div]:w-full [&_button]:flex-1 [&_button]:px-2">{seg}</div> : seg;
}

const presetsFor = (mode: EditMode): PresetId[] => (mode === "multiedit" ? MULTI_PRESETS : mode === "inpaint" ? INPAINT_PRESETS : []);
const activePreset = (mode: EditMode, multi: PresetId | null, inpaint: PresetId | null) => (mode === "multiedit" ? multi : mode === "inpaint" ? inpaint : null);

/** Mobile main controls: one scrolling row of chips; everything else is in the Advanced sheet. */
export function EditChips() {
  const s = useEdit();
  const mode = s.mode;
  const open = () => useUi.getState().set({ advancedOpen: true });
  const active = activePreset(mode, s.multi.preset, s.inpaint.preset);
  return (
    <div className="no-scrollbar -mx-3.5 flex items-center gap-1.5 overflow-x-auto px-3.5 py-1">
      <IconButton label="Advanced settings" onClick={open} className="-ml-2 border border-line-strong">
        <SlidersHorizontal size={18} strokeWidth={1.7} />
      </IconButton>
      {presetsFor(mode).map((id) => (
        <Chip key={id} on={active === id} onClick={() => togglePreset(id)} tip={PRESETS[id].tip}>
          {PRESETS[id].label}
        </Chip>
      ))}
      {mode !== "outpaint" && (
        <Chip on={s.enhancer[mode]} onClick={() => s.patch({ enhancer: { ...s.enhancer, [mode]: !s.enhancer[mode] } })} tip={T.enhancer}>
          Enhancer
        </Chip>
      )}
      {mode === "multiedit" && (
        <>
          <Chip on={s.multi.keepOriginal} onClick={() => s.setMulti({ keepOriginal: !s.multi.keepOriginal })} tip={T.keepOriginal}>
            Keep size
          </Chip>
          <Chip on={s.multi.pixelDrift} onClick={() => s.setPixelDrift(!s.multi.pixelDrift)} tip={T.pixelDrift}>
            Pixel drift
          </Chip>
        </>
      )}
      {mode === "outpaint" && (
        <Chip
          toggle={false}
          onClick={() => {
            const i = FILL_CYCLE.findIndex((f) => f.value === s.outpaint.fillMode);
            s.setOutpaint({ fillMode: FILL_CYCLE[(i + 1) % FILL_CYCLE.length]!.value });
          }}
          label={`Fill: ${s.outpaint.fillMode}. Tap to change`}
          tip={T.fillMode}
        >
          {FILL_CYCLE.find((f) => f.value === s.outpaint.fillMode)?.label}
        </Chip>
      )}
    </div>
  );
}

/** Desktop main controls (left pane): presets and toggles, with Advanced as an inline collapsible. */
export function EditToggles() {
  const s = useEdit();
  const mode = s.mode;
  const open = useUi((u) => u.advancedInline);
  const active = activePreset(mode, s.multi.preset, s.inpaint.preset);
  return (
    <div className="space-y-3">
      {presetsFor(mode).length > 0 && (
        <div>
          <Label>Presets</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {presetsFor(mode).map((id) => (
              <Chip key={id} on={active === id} onClick={() => togglePreset(id)} tip={PRESETS[id].tip}>
                {PRESETS[id].label}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div>
        {mode !== "outpaint" && <Toggle on={s.enhancer[mode]} onChange={(v) => s.patch({ enhancer: { ...s.enhancer, [mode]: v } })} label="Prompt enhancer" tip={T.enhancer} />}
        {mode === "multiedit" && (
          <>
            <Toggle on={s.multi.keepOriginal} onChange={(keepOriginal) => s.setMulti({ keepOriginal })} label="Keep original resolution" tip={T.keepOriginal} />
            <Toggle on={s.multi.pixelDrift} onChange={(on) => s.setPixelDrift(on)} label="Pixel Drift Fix" tip={T.pixelDrift} />
          </>
        )}
      </div>
      {mode === "outpaint" && (
        <div>
          <Label>Padding (pixels)</Label>
          <div className="mt-1">
            <PaddingFields />
          </div>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => useUi.getState().set({ advancedInline: !open })}
        className="hover-wash flex h-11 w-full items-center justify-between rounded-m border border-line px-3 text-[14px] text-text-2 transition-colors hover:border-line-strong hover:text-text"
      >
        Advanced
        <ChevronDown size={18} strokeWidth={1.7} className={open ? "rotate-180" : ""} />
      </button>
      {open && <EditAdvanced />}
    </div>
  );
}
