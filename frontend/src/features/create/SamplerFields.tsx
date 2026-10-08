import type { ReactNode } from "react";
import type { SamplerDefaults, SamplerFieldsDef } from "../../api/types";
import { Field, Slider, inputCls } from "../../components/ui/controls";
import { useServer } from "../../store/health";
import { TIPS } from "./tips";

type Opts = Partial<SamplerDefaults>;

/** Sampler settings for one pass. Only values that differ from the workflow default are kept as overrides. */
export function SamplerFields({
  title,
  def,
  value,
  onChange,
  action,
}: {
  title: string;
  /** extra control shown in the header, after Reset */
  action?: ReactNode;
  def: SamplerFieldsDef | undefined;
  value: Opts;
  onChange: (v: Opts) => void;
}) {
  const catalog = useServer((s) => s.catalog);
  if (!def) return null;
  const cur = { ...def, ...value };
  const set = <K extends keyof SamplerDefaults>(k: K, v: SamplerDefaults[K]) => {
    const next: Opts = { ...value, [k]: v };
    if (v === (def as Partial<SamplerDefaults>)[k]) delete next[k];
    onChange(next);
  };
  const samplers = catalog?.samplers ?? [def.sampler_name];
  const schedulers = catalog?.schedulers ?? (def.scheduler ? [def.scheduler] : []);
  const changed = Object.keys(value).length > 0;

  return (
    <fieldset className="space-y-3 rounded-m border border-line p-3">
      <legend className="flex items-center gap-2 px-1 text-[13px] font-medium text-text-2">
        {title}
        {changed && (
          <button type="button" onClick={() => onChange({})} className="hover-wash h-7 rounded-full px-2 text-[12px] text-gold-text">
            Reset
          </button>
        )}
        {action}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Steps" tip={TIPS.steps}>
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
        <Field label="CFG" tip={TIPS.cfg}>
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
        <Field label="Sampler" tip={TIPS.sampler}>
          <select value={cur.sampler_name} onChange={(e) => set("sampler_name", e.target.value)} className={inputCls}>
            {samplers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        {def.scheduler !== undefined && (
          <Field label="Scheduler" tip={TIPS.scheduler}>
            <select value={cur.scheduler} onChange={(e) => set("scheduler", e.target.value)} className={inputCls}>
              {schedulers.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {def.denoise !== undefined && <Slider tip={TIPS.denoise} label="Denoise" min={0} max={1} step={0.01} value={cur.denoise ?? def.denoise} onChange={(v) => set("denoise", v)} />}
    </fieldset>
  );
}
