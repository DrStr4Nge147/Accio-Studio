import type { Job, SamplerDefaults } from "../../api/types";
import { isKleinModel, KLEIN_MAX_IMAGES } from "./klein";
import { BOX_RULE } from "./presets";
import { useEdit, type CropKey, type EditMode, type EditSettings } from "./store";
import type { Op } from "./maskOps";
import { boxesOf, hasMaskOps } from "./maskOps";
import type { Pads, Slot, Source } from "./workspace";

const nonEmpty = <T extends object>(o: T) => (Object.keys(o).length ? o : undefined);
const isMultiple8 = (n: number) => Number.isInteger(n) && n % 8 === 0 && n >= 64 && n <= 8192;

export const totalPad = (p: Pads) => p.l + p.t + p.r + p.b;

/** What stops Generate right now (shown under the button), or null when the mode is ready. */
export function editBlocker(
  s: EditSettings,
  ws: { slots: Slot[]; inpaint: { src: Source | null; ops: Op[] }; outpaint: { src: Source | null; pads: Pads; upload: { status: string } } },
): string | null {
  const mode = s.mode;
  const klein = isKleinModel(s.model);
  if (mode === "multiedit") {
    const { slots } = ws;
    if (klein && slots.length > KLEIN_MAX_IMAGES) return `Klein takes up to ${KLEIN_MAX_IMAGES} images. Remove ${slots.length - KLEIN_MAX_IMAGES}.`;
    if (!slots.length) return "Add at least one image.";
    if (slots.some((x) => x.status === "error")) return "One image failed to upload. Remove it or add it again.";
    if (slots.some((x) => x.status === "uploading")) return "Uploading images…";
    if (!klein && s.multi.preset && slots.length < 2) return "Head and body swap need a second image: the head or body to use.";
    if (s.multi.manualSize && (!isMultiple8(s.multi.manualW) || !isMultiple8(s.multi.manualH))) return "Output width and height must be multiples of 8, from 64 to 8192.";
    if (!s.prompts.multiedit.trim()) return "Describe the edit first.";
    return null;
  }
  if (mode === "inpaint") {
    if (!ws.inpaint.src) return "Choose an image first.";
    const preset = s.inpaint.preset;
    const rule = preset ? BOX_RULE[preset] : undefined;
    if (rule) {
      const n = boxesOf(ws.inpaint.ops).length;
      if (n < rule.min || n > rule.max) return rule.hint;
    } else if (!hasMaskOps(ws.inpaint.ops)) {
      return "Paint the area you want to change.";
    }
    if (!s.prompts.inpaint.trim()) return "Describe what should appear there.";
    return null;
  }
  if (!ws.outpaint.src) return "Choose an image first.";
  if (ws.outpaint.upload.status === "uploading") return "Uploading the image…";
  if (ws.outpaint.upload.status === "error") return "The image failed to upload. Choose it again.";
  if (totalPad(ws.outpaint.pads) <= 0) return "Drag an edge outward to add padding.";
  return null;
}

const samplerOpt = (s: EditSettings, mode: EditMode) => nonEmpty(s.sampler[mode]);

/** The model a mode runs: Klein is Multi-edit only, so Inpaint and Outpaint use the default even while Klein is chosen. */
export const modelFor = (s: EditSettings, mode: EditMode): string | undefined => (isKleinModel(s.model) && mode !== "multiedit" ? undefined : s.model);

function common(s: EditSettings, mode: EditMode): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const model = modelFor(s, mode);
  let sampler = samplerOpt(s, mode);
  if (sampler && isKleinModel(model)) {
    const { steps, cfg, sampler_name } = sampler; // Klein has no scheduler or denoise
    sampler = nonEmpty(Object.fromEntries(Object.entries({ steps, cfg, sampler_name }).filter(([, v]) => v !== undefined)));
  }
  if (sampler) p.sampler = sampler;
  if (model) p.unet_name = model;
  if (s.grain.on) p.film_grain = s.grain.strength;
  if (s.lockSeed[mode] && s.seeds[mode] !== null) p.seed = s.seeds[mode];
  if (s.loras[mode].length) p.loras = s.loras[mode].map((l) => ({ name: l.name, strength: l.strength, on: l.on }));
  return p;
}

const MP = 1_000_000;
/** Display-only size of the result: image 1 scaled to the workflow's megapixels, or the manual size. */
function multiSizeHint(s: EditSettings, first: Slot | undefined, baseMp: number): [number, number] | undefined {
  const m = s.multi;
  if (m.manualSize) return [m.manualW, m.manualH];
  if (!first?.w || !first.h) return undefined;
  if (m.keepOriginal && !isKleinModel(s.model)) return [first.w, first.h];
  const k = Math.sqrt((m.baseMp ?? baseMp) * MP / (first.w * first.h));
  return [Math.max(1, Math.round(first.w * k)), Math.max(1, Math.round(first.h * k))];
}

export function multiParams(s: EditSettings, slots: Slot[], baseMp = 1): Record<string, unknown> {
  const m = s.multi;
  const klein = isKleinModel(s.model);
  const p: Record<string, unknown> = {
    mode: "multiedit",
    prompt: s.prompts.multiedit.trim(),
    images: slots.map((x) => ({ file: x.file, name: x.name.slice(0, 200) })),
    prompt_enhancer: s.enhancer.multiedit,
    keep_original_resolution: m.keepOriginal && !klein,
    pixel_drift_fix: m.pixelDrift,
    manual_size: m.manualSize,
    manual_width: m.manualW,
    manual_height: m.manualH,
    head_swap: !klein && m.preset === "head",
    body_swap: !klein && m.preset === "body",
    ...common(s, "multiedit"),
  };
  if ((klein || !m.keepOriginal) && m.baseMp !== undefined) p.base_megapixels = m.baseMp;
  const refs = Object.keys(m.refMp).map(Number);
  if (refs.length) {
    const top = Math.max(...refs);
    p.ref_megapixels = Array.from({ length: top + 1 }, (_, i) => m.refMp[i] ?? null);
  }
  const hint = multiSizeHint(s, slots[0], baseMp);
  if (hint) p.size_hint = hint;
  return p;
}

export function inpaintParams(s: EditSettings, image: string, src: Source, source?: string): Record<string, unknown> {
  const i = s.inpaint;
  const p: Record<string, unknown> = {
    mode: "inpaint",
    prompt: s.prompts.inpaint.trim(),
    image,
    prompt_enhancer: s.enhancer.inpaint,
    invert_mask: i.invert,
    fix_edge_halo: i.halo,
    remover: i.preset === "remove",
    mover: i.preset === "move",
    size_hint: [src.w, src.h],
    ...(source ? { source } : {}),
    ...common(s, "inpaint"),
  };
  for (const [k, v] of Object.entries(i.crop)) if (v !== undefined) p[k] = v;
  if (i.seam) p.seam = i.seam;
  return p;
}

export function outpaintParams(s: EditSettings, src: Source, file: string, pads: Pads, defaultPrompt: string): Record<string, unknown> {
  const o = s.outpaint;
  const p: Record<string, unknown> = {
    mode: "outpaint",
    prompt: s.prompts.outpaint.trim() || defaultPrompt,
    image: file,
    pad_left: pads.l,
    pad_top: pads.t,
    pad_right: pads.r,
    pad_bottom: pads.b,
    fill_mode: o.fillMode,
    fill_color: o.fillColor,
    fix_edge_halo: o.halo,
    outpaint_lora_on: o.loraOn,
    size_hint: [src.w + pads.l + pads.r, src.h + pads.t + pads.b],
    ...common(s, "outpaint"),
  };
  if (o.blur !== undefined) p.backdrop_blur = o.blur;
  if (o.feather !== undefined) p.feather = o.feather;
  if (o.targetMp !== undefined) p.target_megapixels = o.targetMp;
  if (o.seam) p.seam = o.seam;
  if (o.loraStrength !== undefined) p.outpaint_lora_strength = o.loraStrength;
  return p;
}

const diffSampler = (from: Record<string, any> | null | undefined, def: SamplerDefaults | undefined): Partial<SamplerDefaults> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(from ?? {})) if (v !== null && v !== undefined && (!def || def[k as keyof SamplerDefaults] !== v)) out[k] = v;
  return out as Partial<SamplerDefaults>;
};

const CROP_KEYS: CropKey[] = ["context_factor", "blend_pixels", "mask_grow", "mask_blur", "context_pixels", "output_multiple", "target_megapixels"];

/** "Reuse settings" for an Edit job: put its settings and seed back in the composer (images are restored by the caller). */
export function reuseEditSettings(job: Job, def: import("../../api/types").EditDefaults | null, keepSeed = true) {
  const p = job.params;
  const mode = p.mode as EditMode;
  if (mode !== "multiedit" && mode !== "inpaint" && mode !== "outpaint") return;
  const st = useEdit.getState();
  st.patch({ mode, model: p.unet_name ?? undefined });
  st.setGrain(p.film_grain ? { on: true, strength: p.film_grain } : { on: false });
  st.setPrompt(mode, p.prompt ?? "");
  const klein = isKleinModel(p.unet_name ?? undefined);
  st.setSampler(mode, diffSampler(p.sampler, klein && def ? (def.klein.sampler as SamplerDefaults) : def?.[mode].sampler));
  st.setLoras(
    mode,
    ((p.loras ?? []) as { name: string; strength?: number; on?: boolean }[]).map((l) => ({ name: String(l.name), strength: l.strength ?? 1, on: l.on ?? true, target: "both" as const })),
  );
  st.setSeed(mode, keepSeed, keepSeed ? (job.seeds.main ?? null) : null);
  if (mode === "multiedit") {
    st.patch({ enhancer: { ...useEdit.getState().enhancer, multiedit: p.prompt_enhancer ?? true } });
    const refMp: Record<number, number> = {};
    ((p.ref_megapixels ?? []) as (number | null)[]).forEach((v, i) => v != null && (refMp[i] = v));
    st.setMulti({
      keepOriginal: !!p.keep_original_resolution,
      pixelDrift: p.pixel_drift_fix ?? true,
      driftAuto: false,
      manualSize: !!p.manual_size,
      manualW: p.manual_width ?? 1024,
      manualH: p.manual_height ?? 1024,
      baseMp: p.base_megapixels ?? undefined,
      refMp,
      preset: p.head_swap ? "head" : p.body_swap ? "body" : null,
    });
  } else if (mode === "inpaint") {
    st.patch({ enhancer: { ...useEdit.getState().enhancer, inpaint: p.prompt_enhancer ?? true } });
    const crop: Record<string, number> = {};
    for (const k of CROP_KEYS) if (p[k] !== undefined && p[k] !== null && def?.inpaint.crop[k] !== p[k]) crop[k] = p[k];
    st.setInpaint({ invert: !!p.invert_mask, halo: !!p.fix_edge_halo, seam: p.seam && p.seam !== def?.inpaint.seam ? p.seam : undefined, crop, preset: p.remover ? "remove" : p.mover ? "move" : null });
  } else {
    const d = def?.outpaint;
    const keep = <T,>(v: T | undefined, dv: T | undefined) => (v !== undefined && v !== dv ? v : undefined);
    st.setOutpaint({
      fillMode: p.fill_mode ?? "color",
      fillColor: p.fill_color ?? "#808080",
      blur: keep(p.backdrop_blur, d?.backdrop_blur),
      feather: keep(p.feather, d?.feather),
      targetMp: keep(p.target_megapixels, d?.target_megapixels),
      halo: !!p.fix_edge_halo,
      seam: keep(p.seam, d?.seam),
      loraOn: p.outpaint_lora_on ?? true,
      loraStrength: keep(p.outpaint_lora_strength, d?.lora_strength),
    });
  }
}
