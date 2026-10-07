import { inputCls } from "../../components/ui/controls";
import { MAX_PAD, clampPad } from "./pads";
import { setPads, useWorkspace, type Pads } from "./workspace";

type Side = keyof Pads;

/** The four numeric padding fields (main control next to the drag handles). */
export function PaddingFields() {
  const pads = useWorkspace((s) => s.outpaint.pads);
  const src = useWorkspace((s) => s.outpaint.src);
  const set = (k: Side) => (e: React.ChangeEvent<HTMLInputElement>) => setPads({ ...pads, [k]: clampPad(Number(e.target.value)) });
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {([
          ["l", "Left"],
          ["r", "Right"],
          ["t", "Top"],
          ["b", "Bottom"],
        ] as const).map(([k, label]) => (
          <label key={k} className="block">
            <span className="text-[12px] font-medium tracking-wide text-text-3">{label}</span>
            <input type="number" inputMode="numeric" min={0} max={MAX_PAD} step={8} aria-label={`${label} padding in pixels`} value={pads[k]} onChange={set(k)} className={`${inputCls} mt-1 font-mono`} />
          </label>
        ))}
      </div>
      {src && (
        <p className="mt-2 text-[12px] text-text-3">
          Canvas {src.w + pads.l + pads.r}×{src.h + pads.t + pads.b} px, scaled to about the target megapixels when generating.
        </p>
      )}
    </div>
  );
}
