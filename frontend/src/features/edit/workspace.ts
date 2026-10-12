import { create } from "zustand";
import { ApiError } from "../../api/http";
import { uploadImage } from "../../api/upload";
import type { Op } from "./maskOps";

/** An image the user brought for Inpaint or Outpaint. */
export interface Source {
  blob: Blob;
  /** blob: URL for display (the browser applies EXIF orientation, like the backend does) */
  url: string;
  w: number;
  h: number;
  name: string;
}

export interface Slot {
  id: string;
  name: string;
  /** blob: URL while local, or the served input URL when restored from a past job */
  url: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  /** server file name once uploaded */
  file?: string;
  error?: string;
  /** upright pixel size, once decoded */
  w?: number;
  h?: number;
}

export interface Pads {
  l: number;
  t: number;
  r: number;
  b: number;
}
export const NO_PADS: Pads = { l: 0, t: 0, r: 0, b: 0 };

export interface OutpaintUpload {
  status: "idle" | "uploading" | "ready" | "error";
  progress: number;
  file?: string;
  error?: string;
}

export const MAX_SLOTS = 9;

/** Everything the Edit canvases hold that cannot be persisted (files, strokes). Cleared by a reload. */
interface Workspace {
  slots: Slot[];
  inpaint: { src: Source | null; ops: Op[]; redo: Op[] };
  outpaint: { src: Source | null; pads: Pads; upload: OutpaintUpload };
  /** Character sheet: the one photo, uploaded as soon as it is picked. */
  sheet: { src: Source | null; upload: OutpaintUpload };
  /** "Before" image of an Edit job, for the compare slider (this session only). */
  before: Record<string, string>;
  /** Inpaint: the painted shape of a running job (transparent PNG), for the sweep over the area being regenerated. */
  maskPreview: Record<string, string>;
  setSlots: (fn: (s: Slot[]) => Slot[]) => void;
  setInpaint: (p: Partial<Workspace["inpaint"]>) => void;
  setOutpaint: (p: Partial<Workspace["outpaint"]>) => void;
  setSheet: (p: Partial<Workspace["sheet"]>) => void;
  setBefore: (jobId: string, url: string) => void;
  setMaskPreview: (jobId: string, url: string) => void;
}

export const useWorkspace = create<Workspace>((set) => ({
  slots: [],
  inpaint: { src: null, ops: [], redo: [] },
  outpaint: { src: null, pads: NO_PADS, upload: { status: "idle", progress: 0 } },
  sheet: { src: null, upload: { status: "idle", progress: 0 } },
  before: {},
  maskPreview: {},
  setSlots: (fn) => set((s) => ({ slots: fn(s.slots) })),
  setInpaint: (p) => set((s) => ({ inpaint: { ...s.inpaint, ...p } })),
  setOutpaint: (p) => set((s) => ({ outpaint: { ...s.outpaint, ...p } })),
  setSheet: (p) => set((s) => ({ sheet: { ...s.sheet, ...p } })),
  setBefore: (jobId, url) => set((s) => ({ before: { ...s.before, [jobId]: url } })),
  setMaskPreview: (jobId, url) => set((s) => ({ maskPreview: { ...s.maskPreview, [jobId]: url } })),
}));

const uid = () => Math.random().toString(36).slice(2, 10);
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Decode enough of the file to learn its (upright) size; rejects when the browser cannot read it. */
export async function loadSource(blob: Blob, name: string): Promise<Source> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error("That file isn't an image this browser can read. Use a PNG, JPEG or WebP.");
  }
  const src: Source = { blob, url: URL.createObjectURL(blob), w: bmp.width, h: bmp.height, name };
  bmp.close();
  return src;
}

export const imageFiles = (list: Iterable<File>) => [...list].filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(f.name));

// ----------------------------------------------------------------------------- Multi-edit slots

function patchSlot(id: string, p: Partial<Slot>) {
  useWorkspace.getState().setSlots((slots) => slots.map((s) => (s.id === id ? { ...s, ...p } : s)));
}

/** Keeps the original files of failed uploads so "Retry" can send them again. */
const pending = new Map<string, File>();

function uploadSlot(id: string, f: File) {
  pending.set(id, f);
  uploadImage("media", f, (progress) => patchSlot(id, { progress }))
    .then((file) => {
      pending.delete(id);
      patchSlot(id, { status: "ready", progress: 1, file });
    })
    .catch((e) => patchSlot(id, { status: "error", error: message(e, "Couldn't upload this image.") }));
}

/** Add images to the tray (up to 9): each shows at once from a local URL and uploads in the background. */
export function addSlotFiles(files: File[]): number {
  const room = MAX_SLOTS - useWorkspace.getState().slots.length;
  const take = files.slice(0, Math.max(0, room));
  for (const f of take) {
    const id = uid();
    const slot: Slot = { id, name: f.name || "image", url: URL.createObjectURL(f), status: "uploading", progress: 0 };
    useWorkspace.getState().setSlots((s) => [...s, slot]);
    uploadSlot(id, f);
    createImageBitmap(f)
      .then((b) => {
        patchSlot(id, { w: b.width, h: b.height });
        b.close();
      })
      .catch(() => undefined); // an unreadable file is rejected by the upload itself
  }
  return files.length - take.length; // how many did not fit
}

/** Make this file image 1 (the base): it takes the first slot's place, the other images stay as references. */
export function replaceBaseSlot(file: File) {
  const first = useWorkspace.getState().slots[0];
  if (first) removeSlot(first.id);
  addSlotFiles([file]);
  const n = useWorkspace.getState().slots.length;
  if (n > 1) moveSlot(n - 1, 0);
}

export function retrySlot(id: string) {
  const f = pending.get(id);
  if (!f) return;
  patchSlot(id, { status: "uploading", progress: 0, error: undefined });
  uploadSlot(id, f);
}

export function removeSlot(id: string) {
  pending.delete(id);
  useWorkspace.getState().setSlots((slots) => {
    const gone = slots.find((s) => s.id === id);
    if (gone?.url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(gone.url), 0);
    return slots.filter((s) => s.id !== id);
  });
}

export function clearSlots() {
  for (const s of useWorkspace.getState().slots) removeSlot(s.id);
}

export function moveSlot(from: number, to: number) {
  useWorkspace.getState().setSlots((slots) => {
    if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return slots;
    const next = [...slots];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    return next;
  });
}

/** Slots restored from a past job: the files are already in the backend's input folder. */
export function restoreSlots(images: { file: string; name?: string }[], urlOf: (file: string) => string) {
  const slots = images.map((i) => ({ id: uid(), name: i.name || i.file, url: urlOf(i.file), status: "ready" as const, progress: 1, file: i.file }));
  useWorkspace.getState().setSlots(() => slots);
  // Read each picture's size, as for a freshly added file: the next job's card needs image 1's shape (size hint).
  for (const s of slots) {
    const img = new Image();
    img.onload = () => patchSlot(s.id, { w: img.naturalWidth, h: img.naturalHeight });
    img.src = s.url;
  }
}

// ----------------------------------------------------------------------------- Inpaint / Outpaint sources

export function setInpaintSource(src: Source | null) {
  useWorkspace.getState().setInpaint({ src, ops: [], redo: [] });
}

export function pushOp(op: Op) {
  const { ops } = useWorkspace.getState().inpaint;
  useWorkspace.getState().setInpaint({ ops: [...ops, op], redo: [] });
}
export function undoOp() {
  const { ops, redo } = useWorkspace.getState().inpaint;
  if (ops.length) useWorkspace.getState().setInpaint({ ops: ops.slice(0, -1), redo: [...redo, ops[ops.length - 1]!] });
}
export function redoOp() {
  const { ops, redo } = useWorkspace.getState().inpaint;
  if (redo.length) useWorkspace.getState().setInpaint({ ops: [...ops, redo[redo.length - 1]!], redo: redo.slice(0, -1) });
}
export function clearOps() {
  useWorkspace.getState().setInpaint({ ops: [], redo: [] });
}

/** Outpaint uploads the original file untouched (no re-encode, parity) as soon as it is picked. */
export function setOutpaintSource(src: Source | null) {
  useWorkspace.getState().setOutpaint({ src, pads: NO_PADS, upload: { status: src ? "uploading" : "idle", progress: 0 } });
  if (!src) return;
  const up = (patch: Partial<OutpaintUpload>) => {
    if (useWorkspace.getState().outpaint.src !== src) return; // another image replaced it meanwhile
    useWorkspace.getState().setOutpaint({ upload: { ...useWorkspace.getState().outpaint.upload, ...patch } });
  };
  uploadImage("image", src.blob, (progress) => up({ progress }))
    .then((file) => up({ status: "ready", progress: 1, file }))
    .catch((e) => up({ status: "error", error: message(e, "Couldn't upload this image.") }));
}

/** Character sheet: the photo goes to the same upload folder as Multi-edit images (the sheet's jobs are Multi-edit jobs). */
export function setSheetSource(src: Source | null, uploaded?: string) {
  useWorkspace.getState().setSheet({ src, upload: uploaded ? { status: "ready", progress: 1, file: uploaded } : { status: src ? "uploading" : "idle", progress: 0 } });
  if (!src || uploaded) return;
  const up = (patch: Partial<OutpaintUpload>) => {
    if (useWorkspace.getState().sheet.src !== src) return; // another photo replaced it meanwhile
    useWorkspace.getState().setSheet({ upload: { ...useWorkspace.getState().sheet.upload, ...patch } });
  };
  uploadImage("media", src.blob, (progress) => up({ progress }))
    .then((file) => up({ status: "ready", progress: 1, file }))
    .catch((e) => up({ status: "error", error: message(e, "Couldn't upload this image.") }));
}

export function setPads(pads: Pads) {
  useWorkspace.getState().setOutpaint({ pads });
}

/** Route dropped, pasted or picked images to a mode. Returns an error text, or null. */
export async function giveFilesToMode(mode: "multiedit" | "inpaint" | "outpaint" | "charsheet", files: File[]): Promise<string | null> {
  const list = imageFiles(files);
  if (!list.length) return "That isn't an image. Use a PNG, JPEG or WebP.";
  if (mode === "multiedit") {
    const left = addSlotFiles(list);
    return left ? `Only ${MAX_SLOTS} images fit. ${left} skipped.` : null;
  }
  try {
    const src = await loadSource(list[0]!, list[0]!.name || "image");
    if (mode === "inpaint") setInpaintSource(src);
    else if (mode === "charsheet") setSheetSource(src);
    else setOutpaintSource(src);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't open that image.";
  }
}
