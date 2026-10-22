import { makeUploadUsable, type UploadedImage } from "../../api/endpoints";
import { inputUrl } from "../../api/upload";
import type { EditMode } from "./store";
import { addUploadedSlots, loadSource, MAX_SLOTS, NO_PADS, setInpaintSource, setSheetSource, useWorkspace } from "./workspace";

/** How many images a mode can take from the earlier uploads at once. */
export const recallLimit = (mode: EditMode) => (mode === "multiedit" ? Math.max(0, MAX_SLOTS - useWorkspace.getState().slots.length) : 1);

async function sourceOf(u: UploadedImage, name: string) {
  const res = await fetch(inputUrl(u.kind, u.file));
  if (!res.ok) throw new Error("That image was deleted.");
  const src = await loadSource(await res.blob(), name);
  src.uploaded = u.file;
  return src;
}

/** Use images uploaded earlier in an Edit mode without uploading them again. Returns an error text, or null. */
export async function recallUploads(mode: EditMode, items: UploadedImage[]): Promise<string | null> {
  if (!items.length) return null;
  try {
    if (mode === "multiedit") {
      await Promise.all(items.map((u) => makeUploadUsable(u.file, "media")));
      const left = addUploadedSlots(items.map((u) => ({ file: u.file, url: inputUrl("media", u.file) })));
      return left ? `Only ${MAX_SLOTS} images fit. ${left} skipped.` : null;
    }
    const u = items[0]!;
    if (mode === "inpaint") {
      setInpaintSource(await sourceOf(u, "image")); // only the mask is uploaded when it is sent; the original is already there
    } else if (mode === "outpaint") {
      await makeUploadUsable(u.file, "image");
      const src = await sourceOf(u, "image");
      useWorkspace.getState().setOutpaint({ src, pads: NO_PADS, upload: { status: "ready", progress: 1, file: u.file } });
    } else {
      await makeUploadUsable(u.file, "media");
      setSheetSource(await sourceOf(u, "photo"), u.file);
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't open that image.";
  }
}
