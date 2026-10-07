import type { SamplerDefaults } from "../../api/types";
import { Field, Slider, inputCls } from "../../components/ui/controls";
import { useServer } from "../../store/health";

type Opts = Partial<SamplerDefaults>;

/** Sampler settings for one pass. Only values that differ from the workflow default are kept as overrides. */
export function SamplerFields({
  title,
  def,
  value,
  onChange,
}: {
  title: string;
  def: SamplerDefaults | undefined;
  value: Opts;
  onChange: (v: Opts) => void;
}) {
  const catalog = useServer((s) => s.catalog);
  if (!def) return null;
  const cur = { ...def, ...value };
  const set = <K extends keyof SamplerDefaults>(k: K, v: SamplerDefaults[K]) => {
    const next: Opts = { ...value, [k]: v };
    if (v === def[k]) delete next[k];
    onChange(next);
  };
  const samplers = catalog?.samplers ?? [def.sampler_name];
  const schedulers = catalog?.schedulers ?? [def.scheduler];
  const changed = Object.keys(value).length > 0;

  return (
    <fieldset className="space-y-3 rounded-m border border-line p-3">
      <legend className="flex items-center gap-2 px-1 text-[13px] font-medium text-text-2">
        {title}
        {changed && (
          <button type="button" onClick={() => onChange({})} className="h-7 rounded-full px-2 text-[12px] text-gold-text">
            Reset
          </button>
        )}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Steps">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={cur.steps}
            onChange={(e) => set("steps", Math.max(1, Math.min(100, Math.round(Number(e.target.value)) || 1)))}
            className={`${inputCls} font-mono`}
          />
        </Field>
        <Field label="CFG">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={30}
            step={0.1}
            value={cur.cfg}
            onChange={(e) => set("cfg", Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
            className={`${inputCls} font-mono`}
          />
        </Field>
        <Field label="Sampler">
          <select value={cur.sampler_name} onChange={(e) => set("sampler_name", e.target.value)} className={inputCls}>
            {samplers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Scheduler">
          <select value={cur.scheduler} onChange={(e) => set("scheduler", e.target.value)} className={inputCls}>
            {schedulers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      <Slider label="Denoise" min={0} max={1} step={0.01} value={cur.denoise} onChange={(v) => set("denoise", v)} />
    </fieldset>
  );
}
