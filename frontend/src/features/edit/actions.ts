import { create } from "zustand";
import { ApiError, imageUrl } from "../../api/http";
import { submitJob } from "../../api/endpoints";
import { inputUrl, uploadImage } from "../../api/upload";
import type { Job } from "../../api/types";
import { boxStroke, exportInpaintPng } from "../../lib/inpaintExport";
import { useServer } from "../../store/health";
import { useJobs } from "../../store/jobs";
import { useUi } from "../../store/ui";
import { boxesOf, isEmptyMask, maskBytes } from "./maskOps";
import { editBlocker, inpaintParams, multiParams, outpaintParams, reuseEditSettings } from "./params";
import { PRESETS, type PresetId } from "./presets";
import { useEdit, type EditMode } from "./store";
import { giveFilesToMode, loadSource, replaceBaseSlot, restoreSlots, setPads, setInpaintSource, setOutpaintSource, useWorkspace } from "./workspace";

interface SubmitState {
  busy: boolean;
  /** what the app is doing before the job exists ("Preparing the mask…") */
  stage: string | null;
  error: string | null;
  setError: (e: string | null) => void;
}
export const useEditSubmit = create<SubmitState>((set) => ({ busy: false, stage: null, error: null, setError: (error) => set({ error }) }));

const defaultsOf = () => useServer.getState().catalog?.defaults.edit ?? null;

export async function generateEdit() {
  const submit = useEditSubmit.getState();
  if (submit.busy) return;
  const s = useEdit.getState();
  const ws = useWorkspace.getState();
  const problem = editBlocker(s, ws);
  if (problem) return submit.setError(problem);
  const mode = s.mode;
  const def = defaultsOf();
  useEditSubmit.setState({ busy: true, stage: null, error: null });
  try {
    let params: Record<string, unknown>;
    let before: string | undefined;
    if (mode === "multiedit") {
      params = multiParams(s, ws.slots, def?.multiedit.base_megapixels ?? 1);
      before = ws.slots[0]?.url;
    } else if (mode === "inpaint") {
      const src = ws.inpaint.src!;
      useEditSubmit.setState({ stage: "Preparing the mask…" });
      const mask = maskBytes(ws.inpaint.ops, src.w, src.h);
      if (isEmptyMask(mask)) throw new Error("The painted area is empty. Paint over what you want to change.");
      const burn = s.inpaint.preset ? boxesOf(ws.inpaint.ops) : [];
      const png = await exportInpaintPng({ file: src.blob, w: src.w, h: src.h, mask, boxes: burn, stroke: boxStroke(src.w, src.h) });
      useEditSubmit.setState({ stage: "Uploading the mask…" });
      const file = await uploadImage("mask", png);
      params = inpaintParams(s, file, src);
      before = src.url;
    } else {
      const o = ws.outpaint;
      params = outpaintParams(s, o.src!, o.upload.file!, o.pads, def?.outpaint.prompt ?? "");
    }
    useEditSubmit.setState({ stage: "Starting…" });
    const job = await submitJob(params);
    const jobs = useJobs.getState();
    jobs.upsert([job]);
    jobs.select(job.id);
    if (before) useWorkspace.getState().setBefore(job.id, before);
    useUi.getState().set({ viewerOpen: true });
    const last = { ...s.loraLastMode };
    for (const l of s.loras[mode]) last[l.name] = "edit";
    useEdit.getState().patch({ loraLastMode: last });
  } catch (e) {
    useEditSubmit.setState({ error: e instanceof ApiError || e instanceof Error ? e.message : "Couldn't start the job." });
  } finally {
    useEditSubmit.setState({ busy: false, stage: null });
  }
}

export function selectEditMode(mode: EditMode) {
  useEdit.getState().patch({ mode });
  // A result of another mode must not stay on the canvas of this one.
  const jobs = useJobs.getState();
  const sel = jobs.selectedId ? jobs.jobs[jobs.selectedId] : undefined;
  if (sel && sel.mode !== mode) {
    jobs.select(null);
    useUi.getState().set({ viewerOpen: false });
  }
  useEditSubmit.getState().setError(null);
}

/** One tap on a preset: enable its LoRA and fill the prompt; a second tap turns it off again. */
export function togglePreset(id: PresetId) {
  const st = useEdit.getState();
  const pr = PRESETS[id];
  const cur = pr.mode === "multiedit" ? st.multi.preset : st.inpaint.preset;
  const turningOff = cur === id;
  const setter = pr.mode === "multiedit" ? st.setMulti : st.setInpaint;
  setter({ preset: turningOff ? null : id } as never);
  if (turningOff) {
    if (st.prompts[pr.mode] === pr.prompt) st.setPrompt(pr.mode, ""); // untouched preset text goes away with it
  } else {
    st.setPrompt(pr.mode, pr.prompt);
  }
  useEditSubmit.getState().setError(null);
}

/** Show a finished result's image to the Edit modes ("Send to Edit"). */
export async function sendToEdit(job: Job, outputIndex: number, mode: EditMode): Promise<string | null> {
  try {
    const res = await fetch(imageUrl(job.id, outputIndex));
    if (!res.ok) return "Couldn't load that image.";
    const blob = await res.blob();
    const name = `accio-${job.seeds.main ?? job.seeds.pass1 ?? "image"}.png`;
    const err = await giveFilesToMode(mode, [new File([blob], name, { type: blob.type || "image/png" })]);
    if (err) return err;
    selectEditMode(mode);
    useUi.getState().set({ tab: "edit", viewerOpen: false });
    useJobs.getState().select(null);
    return null;
  } catch {
    return "Couldn't load that image.";
  }
}

/**
 * "Edit this result": make the result the input of the same Edit mode and return to the editor, so the next Generate builds
 * on it. Multi-edit: it becomes image 1 (references stay). Inpaint / Outpaint: it replaces the source (mask and padding reset).
 */
export async function continueFromResult(job: Job, outputIndex: number): Promise<string | null> {
  const mode = job.mode as EditMode;
  try {
    const res = await fetch(imageUrl(job.id, outputIndex));
    if (!res.ok) return "Couldn't load that image.";
    const blob = await res.blob();
    const file = new File([blob], `accio-${job.seeds.main ?? "result"}.png`, { type: blob.type || "image/png" });
    if (mode === "multiedit") replaceBaseSlot(file);
    else if (mode === "inpaint") setInpaintSource(await loadSource(file, file.name));
    else setOutpaintSource(await loadSource(file, file.name));
    useJobs.getState().select(null);
    useUi.getState().set({ viewerOpen: false });
    useEditSubmit.getState().setError(null);
    return null;
  } catch {
    return "Couldn't load that image.";
  }
}

/** "Reuse settings" for an Edit job: its settings, seed and (where the backend still has them) its images. */
export async function reuseEdit(job: Job) {
  reuseEditSettings(job, defaultsOf());
  useUi.getState().set({ tab: "edit", viewerOpen: false });
  useJobs.getState().select(null);
  useEditSubmit.getState().setError(null);
  const p = job.params;
  if (p.mode === "multiedit") {
    restoreSlots(p.images as { file: string; name?: string }[], (f) => inputUrl("media", f));
  } else if (p.mode === "outpaint") {
    try {
      const res = await fetch(inputUrl("image", p.image));
      if (!res.ok) return;
      const src = await loadSource(await res.blob(), "image");
      useWorkspace.getState().setOutpaint({ src, upload: { status: "ready", progress: 1, file: p.image } });
      setPads({ l: p.pad_left ?? 0, t: p.pad_top ?? 0, r: p.pad_right ?? 0, b: p.pad_bottom ?? 0 });
    } catch {
      /* the image is gone from the backend's input folder: settings are restored, the image has to be chosen again */
    }
  }
}
