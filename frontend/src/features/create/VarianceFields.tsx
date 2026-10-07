import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { InputSpec } from "../../api/types";
import { Field, Slider, inputCls } from "../../components/ui/controls";
import { useServer } from "../../store/health";
import { useCreate } from "./store";

const label = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function VarianceInput({
  name,
  spec,
  def,
  value,
  onChange,
}: {
  name: string;
  spec: InputSpec | undefined;
  def: string | number;
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  const kind = spec?.[0];
  const opts = spec?.[1] ?? {};
  if (Array.isArray(kind)) {
    return (
      <Field label={label(name)}>
        <select value={String(value)} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {kind.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </Field>
    );
  }
  if (typeof def === "number") {
    const int = kind === "INT" || Number.isInteger(def);
    if (opts.min !== undefined && opts.max !== undefined && opts.max - opts.min <= 1000) {
      return (
        <Slider
          label={label(name)}
          min={opts.min}
          max={opts.max}
          step={opts.step ?? (int ? 1 : 0.05)}
          value={Number(value)}
          format={(v) => (int ? String(v) : v.toFixed(2))}
          onChange={onChange}
        />
      );
    }
    return (
      <Field label={label(name)}>
        <input
          type="number"
          inputMode="decimal"
          value={Number(value)}
          min={opts.min}
          max={opts.max}
          onChange={(e) => onChange(int ? Math.round(Number(e.target.value)) : Number(e.target.value))}
          className={`${inputCls} font-mono`}
        />
      </Field>
    );
  }
  return (
    <Field label={label(name)}>
      <input type="text" value={String(value)} maxLength={200} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </Field>
  );
}

/** Seed Variance settings: the preset up front, every other setting of the node under "All settings". */
export function VarianceFields() {
  const catalog = useServer((s) => s.catalog);
  const overrides = useCreate((s) => s.variance);
  const patch = useCreate((s) => s.patch);
  const [more, setMore] = useState(false);
  const defaults = catalog?.defaults.variance;
  if (!catalog || !defaults) return null;

  const val = (k: string) => overrides[k] ?? defaults[k];
  const set = (k: string, v: string | number) => {
    const next = { ...overrides, [k]: v };
    if (v === defaults[k]) delete next[k];
    patch({ variance: next });
  };
  const rest = Object.keys(defaults).filter((k) => k !== "variance_preset");
  const isCustom = String(val("variance_preset")).toLowerCase().includes("custom");

  return (
    <fieldset className="space-y-3 rounded-m border border-line p-3">
      <legend className="flex items-center gap-2 px-1 text-[13px] font-medium text-text-2">
        Seed variance
        {Object.keys(overrides).length > 0 && (
          <button type="button" onClick={() => patch({ variance: {} })} className="h-7 rounded-full px-2 text-[12px] text-gold-text">
            Reset
          </button>
        )}
      </legend>
      <VarianceInput
        name="variance_preset"
        spec={catalog.variance.variance_preset}
        def={defaults.variance_preset}
        value={val("variance_preset")}
        onChange={(v) => set("variance_preset", v)}
      />
      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore((m) => !m)}
        className="flex h-11 w-full items-center justify-between text-[13px] text-text-2"
      >
        All settings
        <ChevronDown size={18} strokeWidth={1.7} className={more ? "rotate-180" : ""} />
      </button>
      {more && (
        <div className="space-y-3">
          {!isCustom && <p className="text-[12px] text-text-3">Fine-tune only applies when the preset is Custom.</p>}
          {rest.map((k) => (
            <VarianceInput key={k} name={k} spec={catalog.variance[k]} def={defaults[k]} value={val(k)} onChange={(v) => set(k, v)} />
          ))}
        </div>
      )}
    </fieldset>
  );
}
