import { useEffect, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import type { EditDefaults } from "../../api/types";
import { LoraList } from "../../components/LoraList";
import { Field, Label, Slider, Toggle, inputCls } from "../../components/ui/controls";
import { useServer } from "../../store/health";
import { SamplerFields } from "../create/SamplerFields";
import { SeedInput, randomSeed } from "../create/SeedFields";
import { PaddingFields } from "./PaddingFields";
import { EDIT_TIPS as T } from "./tips";
import { useEdit, type CropKey, type EditMode, type FillMode, type Seam } from "./store";
import { useWorkspace } from "./workspace";

const FILL_MODES: { value: FillMode; label: string }[] = [
  { value: "color", label: "Solid colour" },
  { value: "edge", label: "Stretch edge" },
  { value: "edge pixel", label: "Edge pixel" },
  { value: "pillarbox blur", label: "Blurred backdrop" },
  { value: "mirror", label: "Mirror" },
];

/** A slider whose value is stored only when it differs from the workflow default. */
function Tuned({ label, tip, value, def, min, max, step, format, onChange }: { label: string; tip: string; value: number | undefined; def: number; min: number; max: number; step: number; format?: (v: number) => string; onChange: (v: number | undefined) => void }) {
  return <Slider label={label} tip={tip} min={min} max={max} step={step} value={value ?? def} format={format} onChange={(v) => onChange(v === def ? undefined : v)} />;
}

function SeedField({ mode }: { mode: EditMode }) {
  const lock = useEdit((s) => s.lockSeed[mode]);
  const seed = useEdit((s) => s.seeds[mode]);
  const setSeed = useEdit((s) => s.setSeed);
  return (
    <div>
      <Toggle on={lock} onChange={(on) => setSeed(mode, on, on ? seed ?? randomSeed() : seed)} label="Lock seed" sub="Same seed again for the same settings" />
      {lock && (
        <div className="mt-2">
          <SeedInput label="Seed" value={seed} onChange={(v) => setSeed(mode, true, v)} />
        </div>
      )}
    </div>
  );
}

/** Saves the sampler settings for the chosen model; shown only for a non-default model. */
function SavePreset() {
  const model = useEdit((s) => s.model);
  const has = useEdit((s) => !!(s.model && s.modelPresets[s.model]));
  const save = useEdit((s) => s.saveModelPreset);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);
  if (!model) return null;
  return (
    <button
      type="button"
      onClick={() => {
        save();
        setDone(true);
      }}
      className="hover-wash flex h-7 items-center gap-1 rounded-full px-2 text-[12px] font-normal text-gold-text"
    >
      {done && <Check size={13} strokeWidth={1.7} />}
      {done ? "Saved" : has ? "Update for this model" : "Save for this model"}
    </button>
  );
}

/** Which Qwen diffusion model the Edit modes run. The default is the workflow's own (a 6-step turbo build). */
function ModelField({ def }: { def: string }) {
  const models = useServer((s) => s.catalog?.edit_models) ?? [];
  const model = useEdit((s) => s.model);
  const setModel = useEdit((s) => s.setModel);
  if (!models.length && !model) return null;
  const missing = model && !models.includes(model);
  const list = models.filter((m) => m !== def);
  return (
    <Field label="Model" tip={T.model}>
      <select value={model ?? ""} onChange={(e) => setModel(e.target.value || undefined)} className={inputCls}>
        <option value="">Default · {def}</option>
        {missing && <option value={model}>{model} (not installed)</option>}
        {list.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {model && <p className="mt-1.5 text-[12px] text-text-3">The default settings suit the default turbo model. A different model may need other sampler steps and CFG.</p>}
    </Field>
  );
}

function MultiFields({ def }: { def: EditDefaults["multiedit"] }) {
  const m = useEdit((s) => s.multi);
  const set = useEdit((s) => s.setMulti);
  const setManual = useEdit((s) => s.setManualSize);
  const count = useWorkspace((s) => s.slots.length);
  return (
    <div className="space-y-3">
      <div>
        <Toggle on={m.manualSize} onChange={(on) => setManual(on)} label="Manual output size" sub="Otherwise the result follows image 1" tip={T.manualSize} />
        {m.manualSize && (
          <>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Field label="Width">
                <input type="number" inputMode="numeric" step={8} min={64} max={8192} value={m.manualW} onChange={(e) => set({ manualW: Number(e.target.value) })} className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Height">
                <input type="number" inputMode="numeric" step={8} min={64} max={8192} value={m.manualH} onChange={(e) => set({ manualH: Number(e.target.value) })} className={`${inputCls} font-mono`} />
              </Field>
            </div>
            {m.pixelDrift ? (
              <p className="mt-1.5 text-[12px] text-text-3">Pixel Drift Fix is on: it realigns the result to image 1 and returns it at image 1's size, which undoes this manual size. Turn it off to keep the size.</p>
            ) : (
              <p className="mt-1.5 text-[12px] text-text-3">{m.driftAuto ? "Pixel Drift Fix was turned off because it would resize the result back to image 1's size. You can turn it back on." : "Pixel Drift Fix is off."}</p>
            )}
          </>
        )}
      </div>
      {!m.keepOriginal && <Tuned label="Image 1 size" tip={T.baseMp} value={m.baseMp} def={def.base_megapixels} min={0.25} max={4} step={0.05} format={(v) => `${v.toFixed(2)} MP`} onChange={(baseMp) => set({ baseMp })} />}
      {Array.from({ length: Math.max(0, Math.min(count, 9) - 1) }, (_, i) => (
        <Tuned
          key={i}
          label={`Image ${i + 2} size`}
          tip={T.refMp}
          value={m.refMp[i]}
          def={def.ref_megapixels[i] ?? 1}
          min={0.25}
          max={4}
          step={0.05}
          format={(v) => `${v.toFixed(2)} MP`}
          onChange={(v) => {
            const next = { ...m.refMp };
            if (v === undefined) delete next[i];
            else next[i] = v;
            set({ refMp: next });
          }}
        />
      ))}
    </div>
  );
}

function InpaintFields({ def }: { def: EditDefaults["inpaint"] }) {
  const i = useEdit((s) => s.inpaint);
  const set = useEdit((s) => s.setInpaint);
  const crop = (k: CropKey) => (v: number | undefined) => {
    const next = { ...i.crop };
    if (v === undefined) delete next[k];
    else next[k] = v;
    set({ crop: next });
  };
  return (
    <div className="space-y-3">
      <Toggle on={i.invert} onChange={(invert) => set({ invert })} label="Invert mask" sub="Change everything except the painted area" tip={T.invert} />
      <Tuned label="Mask grow" tip={T.maskGrow} value={i.crop.mask_grow} def={def.crop.mask_grow} min={-64} max={128} step={1} format={(v) => `${v} px`} onChange={crop("mask_grow")} />
      <Tuned label="Context factor" tip={T.contextFactor} value={i.crop.context_factor} def={def.crop.context_factor} min={1} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={crop("context_factor")} />
      <Tuned label="Blend pixels" tip={T.blendPixels} value={i.crop.blend_pixels} def={def.crop.blend_pixels} min={0} max={128} step={1} format={(v) => `${v} px`} onChange={crop("blend_pixels")} />
      <Toggle on={i.halo} onChange={(halo) => set({ halo })} label="Fix edge halo" tip={T.halo} />
      <Field label="Seam" tip={T.seam}>
        <select value={i.seam ?? def.seam} onChange={(e) => set({ seam: e.target.value === def.seam ? undefined : (e.target.value as Seam) })} className={inputCls}>
          <option value="classic">Classic</option>
          <option value="blend in">Blend in</option>
        </select>
      </Field>
    </div>
  );
}

function OutpaintFields({ def }: { def: EditDefaults["outpaint"] }) {
  const o = useEdit((s) => s.outpaint);
  const set = useEdit((s) => s.setOutpaint);
  return (
    <div className="space-y-3">
      <Field label="Fill the new area with" tip={T.fillMode}>
        <select value={o.fillMode} onChange={(e) => set({ fillMode: e.target.value as FillMode })} className={inputCls}>
          {FILL_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      {o.fillMode === "color" && (
        <div>
          <Label>Fill colour</Label>
          <div className="mt-1 flex items-center gap-2">
            <input type="color" aria-label="Fill colour" value={o.fillColor} onChange={(e) => set({ fillColor: e.target.value.toUpperCase() })} className="h-11 w-14 cursor-pointer rounded-s border border-line bg-raised p-1" />
            <span className="font-mono text-[13px] text-text-2">{o.fillColor}</span>
            {o.fillColor.toLowerCase() !== def.fill_color.toLowerCase() && (
              <button type="button" onClick={() => set({ fillColor: def.fill_color })} className="hover-wash h-9 rounded-full px-2 text-[12px] text-gold-text">
                Reset
              </button>
            )}
          </div>
        </div>
      )}
      {o.fillMode === "pillarbox blur" && <Tuned label="Backdrop blur" tip={T.fillMode} value={o.blur} def={def.backdrop_blur} min={0} max={1} step={0.05} onChange={(blur) => set({ blur })} />}
      <Tuned label="Feather" tip={T.feather} value={o.feather} def={def.feather} min={0} max={256} step={1} format={(v) => `${v} px`} onChange={(feather) => set({ feather })} />
      <Tuned label="Target size" tip={T.targetMp} value={o.targetMp} def={def.target_megapixels} min={0.5} max={4} step={0.1} format={(v) => `${v.toFixed(1)} MP`} onChange={(targetMp) => set({ targetMp })} />
      <Toggle on={o.halo} onChange={(halo) => set({ halo })} label="Fix edge halo" tip={T.halo} />
      <Field label="Seam" tip={T.seam}>
        <select value={o.seam ?? def.seam} onChange={(e) => set({ seam: e.target.value === def.seam ? undefined : (e.target.value as Seam) })} className={inputCls}>
          <option value="classic">Classic</option>
          <option value="blend in">Blend in</option>
        </select>
      </Field>
      <div className="space-y-1">
        <Toggle on={o.loraOn} onChange={(loraOn) => set({ loraOn })} label="Outpaint LoRA" tip={T.outpaintLora} />
        <Tuned label="Strength" tip={T.outpaintLora} value={o.loraStrength} def={def.lora_strength} min={0} max={2} step={0.05} onChange={(loraStrength) => set({ loraStrength })} />
      </div>
    </div>
  );
}

/** Advanced controls for the current Edit mode. Shown in a sheet on mobile (with padding) and inline on desktop. */
export function EditAdvanced({ withPadding }: { withPadding?: boolean }) {
  const mode = useEdit((s) => s.mode);
  const def = useServer((s) => s.catalog?.defaults.edit);
  const sampler = useEdit((s) => s.sampler[mode]);
  const setSampler = useEdit((s) => s.setSampler);
  const loras = useEdit((s) => s.loras[mode]);
  const setLoras = useEdit((s) => s.setLoras);
  const loraLastMode = useEdit((s) => s.loraLastMode);
  const reset = useEdit((s) => s.reset);
  const enhancerAll = useEdit((s) => s.enhancer);
  const enhancer = enhancerAll[mode as keyof typeof enhancerAll] ?? false;
  const patch = useEdit((s) => s.patch);
  const multi = useEdit((s) => s.multi);
  const setMulti = useEdit((s) => s.setMulti);
  const setPixelDrift = useEdit((s) => s.setPixelDrift);

  return (
    <div className="space-y-4 pb-2">
      {withPadding && mode === "outpaint" && (
        <div>
          <Label>Padding (pixels)</Label>
          <div className="mt-1">
            <PaddingFields />
          </div>
        </div>
      )}
      {withPadding && mode !== "outpaint" && (
        <div>
          <Toggle on={enhancer} onChange={(on) => patch({ enhancer: { ...enhancerAll, [mode]: on } })} label="Prompt enhancer" sub={T.enhancer} />
          {mode === "multiedit" && (
            <>
              <Toggle on={multi.keepOriginal} onChange={(keepOriginal) => setMulti({ keepOriginal })} label="Keep original resolution" sub={T.keepOriginal} />
              <Toggle on={multi.pixelDrift} onChange={(on) => setPixelDrift(on)} label="Pixel Drift Fix" sub={T.pixelDrift} />
            </>
          )}
        </div>
      )}
      <SeedField mode={mode} />
      {def && <ModelField def={def.unet_name} />}
      <SamplerFields title="Sampler" def={def?.[mode].sampler} value={sampler} onChange={(v) => setSampler(mode, v)} action={<SavePreset />} />
      {def && mode === "multiedit" && <MultiFields def={def.multiedit} />}
      {def && mode === "inpaint" && <InpaintFields def={def.inpaint} />}
      {def && mode === "outpaint" && <OutpaintFields def={def.outpaint} />}
      <LoraList mode="edit" loras={loras} loraLastMode={loraLastMode} onChange={(l) => setLoras(mode, l)} />
      <button type="button" onClick={() => reset(mode)} className="hover-wash flex h-11 w-full items-center justify-center gap-2 rounded-s text-[13px] text-text-2 hover:text-text">
        <RotateCcw size={16} strokeWidth={1.7} /> Reset this mode to workflow defaults
      </button>
    </div>
  );
}
