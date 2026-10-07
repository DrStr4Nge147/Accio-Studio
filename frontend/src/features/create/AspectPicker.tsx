import { ASPECTS, CUSTOM, snap8, MAX_DIM, MIN_DIM } from "../../lib/aspects";
import { Label, inputCls } from "../../components/ui/controls";
import { useCreate, type SizeSel } from "./store";

const ICON = 16; // longest side of the little ratio glyph

function Glyph({ w, h }: { w: number; h: number }) {
  const k = ICON / Math.max(w, h);
  return <i className="block rounded-[2px] border-[1.5px] border-current" style={{ width: w * k, height: h * k }} />;
}

export function AspectPicker() {
  const variant = useCreate((s) => s.variant);
  const size = useCreate((s) => s.sizes[s.variant]);
  const patch = useCreate((s) => s.patch);
  const set = (next: SizeSel) => patch({ sizes: { ...useCreate.getState().sizes, [variant]: next } });
  const active = ASPECTS.find((a) => a.key === size.aspect);

  return (
    <div>
      <Label>Aspect</Label>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Aspect ratio">
        {ASPECTS.map((a) => {
          const on = size.aspect === a.key;
          return (
            <button
              key={a.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set({ aspect: a.key, w: a.w, h: a.h })}
              className={`grid h-11 place-items-center rounded-s border text-[12px] transition-colors ${
                on ? "border-gold bg-gold-wash text-gold-text" : "border-line-strong text-text-2"
              }`}
            >
              <span className="flex flex-col items-center gap-0.5">
                <Glyph w={Number(a.key.split(":")[0])} h={Number(a.key.split(":")[1])} />
                {a.key}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={size.aspect === CUSTOM}
          onClick={() => set({ ...size, aspect: CUSTOM })}
          className={`grid h-11 place-items-center rounded-s border text-[12px] ${
            size.aspect === CUSTOM ? "border-gold bg-gold-wash text-gold-text" : "border-line-strong text-text-2"
          }`}
        >
          Custom
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["w", "h"] as const).map((k) => (
          <label key={k} className="block">
            <span className="sr-only">{k === "w" ? "Width" : "Height"}</span>
            <div className="flex items-center gap-2 text-[12px] text-text-3">
              <span className="w-3">{k === "w" ? "W" : "H"}</span>
              <input
                type="number"
                inputMode="numeric"
                step={8}
                min={MIN_DIM}
                max={MAX_DIM}
                value={size[k]}
                onChange={(e) => set({ ...size, aspect: CUSTOM, [k]: Number(e.target.value) })}
                onBlur={() => set({ ...size, [k]: snap8(size[k]) })}
                className={`${inputCls} font-mono`}
              />
            </div>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-text-3">
        {size.w}×{size.h} · {((size.w * size.h) / 1e6).toFixed(2)} MP
        {active?.untested && " · this ratio hasn't been tried with Krea2 yet; results may vary"}
      </p>
    </div>
  );
}
