import { RotateCcw } from "lucide-react";
import { Label, Segmented, Slider, Toggle } from "../../components/ui/controls";
import { useServer } from "../../store/health";
import { AspectPicker } from "./AspectPicker";
import { LoraSection } from "./LoraSection";
import { SamplerFields } from "./SamplerFields";
import { SeedFields } from "./SeedFields";
import { useCreate } from "./store";
import { TIPS } from "./tips";
import { VarianceFields } from "./VarianceFields";

const UPSCALES = [1, 1.25, 1.5, 2] as const;

/** Advanced controls for Create. Shown in a sheet on mobile (with the aspect picker) and inline on desktop. */
export function CreateAdvanced({ withAspect }: { withAspect: boolean }) {
  const s = useCreate();
  const defaults = useServer((x) => x.catalog?.defaults);
  const detailed = s.variant === "detailed";
  const d = defaults?.detailed;

  return (
    <div className="space-y-4 pb-2">
      {withAspect && <AspectPicker />}
      <SeedFields />

      {detailed ? (
        <>
          <SamplerFields title="Pass 1 sampler" def={d?.pass1} value={s.pass1} onChange={(pass1) => s.patch({ pass1 })} />
          <SamplerFields title="Pass 2 sampler (refine)" def={d?.pass2} value={s.pass2} onChange={(pass2) => s.patch({ pass2 })} />
          {([
            ["Turbo LoRA, pass 1", "turbo1", d?.turbo_pass1],
            ["Turbo LoRA, pass 2", "turbo2", d?.turbo_pass2],
          ] as const).map(([title, key, def]) => {
            if (!def) return null;
            const cur = { ...def, ...s[key] };
            // Keep only values that differ from the workflow default.
            const setTurbo = (p: Partial<typeof def>) => {
              const next = { ...s[key], ...p };
              for (const k of Object.keys(next) as (keyof typeof def)[]) if (next[k] === def[k]) delete next[k];
              s.patch({ [key]: next });
            };
            return (
              <div key={key} className="space-y-1">
                <Toggle on={cur.on} onChange={(on) => setTurbo({ on })} label={title} tip={TIPS.turbo} />
                <Slider
                  label="Strength"
                  min={0}
                  max={1}
                  step={0.05}
                  value={cur.strength}
                  disabled={!cur.on}
                  onChange={(strength) => setTurbo({ strength })}
                />
              </div>
            );
          })}
          <div>
            <Label tip={TIPS.upscale}>Upscale before refine</Label>
            <p className="text-[12px] text-text-3">Enlarges the first image before refining: more detail, slower.</p>
            <div className="mt-1.5">
              <Segmented
                label="Upscale before refine"
                value={s.upscale}
                onChange={(upscale) => s.patch({ upscale })}
                options={UPSCALES.map((u) => ({ value: u, label: `${u}×` }))}
              />
            </div>
          </div>
          <Toggle on={s.saveFirstPass} onChange={(saveFirstPass) => s.patch({ saveFirstPass })} label="Save first-pass image" sub="Keep the image from before refining" tip={TIPS.saveFirstPass} />
        </>
      ) : (
        <SamplerFields title="Sampler" def={defaults?.standard.sampler} value={s.sampler} onChange={(sampler) => s.patch({ sampler })} />
      )}

      {s.sharpen && defaults && (
        <Slider
          label="Sharpen strength"
          tip={TIPS.sharpenStrength}
          min={0}
          max={1}
          step={0.05}
          value={s.sharpenStrength ?? defaults.sharpen_strength}
          onChange={(v) => s.patch({ sharpenStrength: v === defaults.sharpen_strength ? undefined : v })}
        />
      )}
      {s.tEnhancer && defaults && (
        <Slider
          label="T-Enhancer strength"
          tip={TIPS.tEnhancerStrength}
          min={0}
          max={2}
          step={0.05}
          value={s.tEnhancerStrength ?? defaults.t_enhancer_strength}
          onChange={(v) => s.patch({ tEnhancerStrength: v === defaults.t_enhancer_strength ? undefined : v })}
        />
      )}
      {s.seedVariance && <VarianceFields />}
      <LoraSection />

      {withAspect && (
        <dl className="space-y-1.5 rounded-m border border-line p-3 text-[12px] leading-snug text-text-3">
          {(
            [
              ["Variance", TIPS.seedVariance],
              ["Sharpen", TIPS.sharpen],
              ["T-Enhancer", TIPS.tEnhancer],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="inline font-medium text-text-2">{k}: </dt>
              <dd className="inline">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <button
        type="button"
        onClick={() => s.reset()}
        className="hover-wash flex h-11 w-full items-center justify-center gap-2 rounded-s text-[13px] text-text-2 hover:text-text"
      >
        <RotateCcw size={16} strokeWidth={1.7} /> Reset everything to workflow defaults
      </button>
    </div>
  );
}
