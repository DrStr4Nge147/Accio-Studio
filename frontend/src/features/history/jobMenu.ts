import { createElement } from "react";
import { Copy, Download, ExternalLink, Pencil, RotateCcw, Trash2, WandSparkles, X } from "lucide-react";
import { deleteJob } from "../../api/endpoints";
import { imageUrl } from "../../api/http";
import type { Job } from "../../api/types";
import type { MenuItem } from "../../components/ui/ContextMenu";
import { requestCancel } from "../create/actions";
import { sendToEdit } from "../edit/actions";
import type { EditMode } from "../edit/store";
import { reuseAny } from "../reuse";
import { useServer } from "../../store/health";
import { isActive, useJobs } from "../../store/jobs";
import { coverIndex } from "./Thumb";
import { openJob } from "./open";

const icon = (I: typeof Copy) => createElement(I, { size: 16, strokeWidth: 1.7 });

const SEND: { mode: EditMode; label: string }[] = [
  { mode: "multiedit", label: "Send to Multi-edit" },
  { mode: "inpaint", label: "Send to Inpaint" },
  { mode: "outpaint", label: "Send to Outpaint" },
];

async function saveImage(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

/** Removes a finished job from the history (and its files when Accio owns the output folder). */
export async function removeJob(job: Job) {
  try {
    await deleteJob(job.id);
    useJobs.getState().remove([job.id]);
  } catch {
    /* it stays in the list; the user can try again */
  }
}

/** Right-click menu for a job tile: queued/running jobs can be cancelled, finished ones opened, reused, sent, saved or deleted. */
export function jobMenuItems(job: Job, outputIndex = coverIndex(job)): MenuItem[] {
  if (isActive(job)) {
    return [
      { label: "Show", icon: icon(ExternalLink), onSelect: () => openJob(job) },
      { label: "Cancel job", icon: icon(X), danger: true, separated: true, onSelect: () => void requestCancel(job.id) },
    ];
  }
  if (job.status !== "done" || !job.outputs.length) return [];
  const canDelete = useServer.getState().health?.can_delete_files === true;
  const prompt = String(job.params.prompt ?? "").trim();
  const url = imageUrl(job.id, outputIndex);
  return [
    { label: "Open", icon: icon(ExternalLink), onSelect: () => openJob(job) },
    { label: "Reuse settings", icon: icon(RotateCcw), onSelect: () => reuseAny(job) },
    ...SEND.map((t, i) => ({ label: t.label, icon: icon(i ? Pencil : WandSparkles), separated: i === 0, onSelect: () => void sendToEdit(job, outputIndex, t.mode) })),
    ...(prompt ? [{ label: "Copy prompt", icon: icon(Copy), separated: true, onSelect: () => void navigator.clipboard?.writeText(prompt).catch(() => undefined) }] : []),
    { label: "Download", icon: icon(Download), onSelect: () => void saveImage(url, `accio-${job.seeds.main ?? job.seeds.pass1 ?? "image"}-${outputIndex + 1}.png`) },
    {
      label: canDelete ? "Delete…" : "Remove from history…",
      confirm: canDelete ? "Click again to delete files" : "Click again to remove",
      icon: icon(Trash2),
      danger: true,
      separated: true,
      onSelect: () => void removeJob(job),
    },
  ];
}
