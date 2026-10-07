import { useEffect, useState } from "react";
import { inputUrl } from "../../api/upload";
import type { Job } from "../../api/types";
import { paddedBefore } from "../../lib/paddedBefore";
import { useWorkspace } from "./workspace";

/**
 * The "before" picture of an Edit job for the compare slider: this session's source if we still have it, else the backend's
 * copy of the original. Outpaint's is the original placed on the padded canvas, built in the browser.
 */
export function useBeforeUrl(job: Job): string | null {
  const session = useWorkspace((s) => s.before[job.id]);
  const [padded, setPadded] = useState<{ id: string; url: string } | null>(null);
  const p = job.params;
  useEffect(() => {
    if (job.mode !== "outpaint" || !p.image) return;
    let alive = true;
    const pads = { l: p.pad_left ?? 0, t: p.pad_top ?? 0, r: p.pad_right ?? 0, b: p.pad_bottom ?? 0 };
    const fill = p.fill_mode === "color" ? p.fill_color : "#808080";
    paddedBefore(job.id, inputUrl("image", p.image), pads, fill)
      .then((url) => alive && setPadded({ id: job.id, url }))
      .catch(() => undefined); // no preview: the compare button just does not appear
    return () => {
      alive = false;
    };
  }, [job.id, job.mode, p.image, p.pad_left, p.pad_top, p.pad_right, p.pad_bottom, p.fill_mode, p.fill_color]);
  if (session) return session;
  if (job.mode === "multiedit") {
    const first = (p.images as { file: string }[] | undefined)?.[0]?.file;
    return first ? inputUrl("media", first) : null;
  }
  if (job.mode === "inpaint") return p.source ? inputUrl("image", p.source) : null;
  if (job.mode === "outpaint") return padded?.id === job.id ? padded.url : null;
  return null;
}
