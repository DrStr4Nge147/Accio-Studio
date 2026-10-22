import { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { deleteUpload, fetchUploads, type UploadedImage } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { inputUrl } from "../../api/upload";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Sheet } from "../../components/ui/Sheet";
import { useEditSubmit } from "./actions";
import { recallLimit, recallUploads } from "./recall";
import type { EditMode } from "./store";
import { forgetUploaded } from "./workspace";

/** Pick images uploaded earlier instead of choosing a file again. The tiles show the stored images themselves (no thumbnail copies). */
export function EarlierUploads({ mode, open, onClose }: { mode: EditMode; open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<UploadedImage[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [asking, setAsking] = useState<string[] | null>(null); // files waiting for a delete confirmation
  const [deleting, setDeleting] = useState(false);
  const limit = recallLimit(mode);

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setMsg(null);
    setAsking(null);
    setItems(null);
    fetchUploads().then(setItems).catch(() => setMsg("Couldn't load the earlier uploads."));
  }, [open]);

  const toggle = (file: string) =>
    setPicked((p) => (p.includes(file) ? p.filter((f) => f !== file) : limit <= 1 ? [file] : p.length < limit ? [...p, file] : p));

  const removeAsked = async () => {
    if (!asking) return;
    setDeleting(true);
    const done: string[] = [];
    let problem: string | null = null;
    for (const file of asking) {
      try {
        await deleteUpload(file);
        forgetUploaded(file);
        done.push(file);
      } catch (e) {
        problem = e instanceof ApiError ? e.message : "Couldn't delete that image.";
        break;
      }
    }
    setItems((l) => l && l.filter((x) => !done.includes(x.file)));
    setPicked((p) => p.filter((f) => !done.includes(f)));
    setMsg(problem);
    setAsking(null);
    setDeleting(false);
  };

  const use = async () => {
    const chosen = (items ?? []).filter((u) => picked.includes(u.file));
    const problem = await recallUploads(mode, chosen);
    useEditSubmit.getState().setError(problem);
    if (!problem) onClose();
    else setMsg(problem);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Earlier uploads"
      desktopModalWidth={720}
      footer={
        <div className="flex gap-2">
          {picked.length > 0 && (
            <button
              type="button"
              onClick={() => setAsking(picked)}
              className="hover-wash flex h-12 items-center gap-2 rounded-full border border-line-strong px-4 text-[14px] font-medium text-danger"
            >
              <Trash2 size={17} strokeWidth={1.8} /> Delete{picked.length > 1 ? ` ${picked.length}` : ""}
            </button>
          )}
          <button
            type="button"
            disabled={!picked.length}
            onClick={() => void use()}
            className="h-12 flex-1 rounded-full bg-gold px-5 text-[15px] font-semibold text-on-gold disabled:opacity-50"
          >
            {picked.length > 1 ? `Use ${picked.length} images` : "Use this image"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {msg && <p className="text-[13px] text-danger">{msg}</p>}
        {items && items.length === 0 && <p className="text-[14px] text-text-3">Nothing uploaded yet. Images you choose for editing are kept here.</p>}
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {(items ?? []).map((u) => {
            const on = picked.includes(u.file);
            return (
              <li key={u.file} className="relative aspect-square">
                <button
                  type="button"
                  onClick={() => toggle(u.file)}
                  aria-pressed={on}
                  className={`h-full w-full overflow-hidden rounded-m border-2 ${on ? "border-gold" : "border-transparent"} bg-raised`}
                >
                  <img src={inputUrl(u.kind, u.file)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  {on && (
                    <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-gold text-on-gold">
                      <Check size={14} strokeWidth={2.5} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Delete this upload"
                  onClick={() => setAsking([u.file])}
                  className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <ConfirmDialog
        open={!!asking}
        title={asking && asking.length > 1 ? `Delete ${asking.length} images?` : "Delete this image?"}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={() => void removeAsked()}
        onCancel={() => setAsking(null)}
      >
        {asking && asking.length > 1 ? "They can't" : "It can't"} be used again, and old edits can no longer show {asking && asking.length > 1 ? "them" : "it"} as the original.
      </ConfirmDialog>
    </Sheet>
  );
}
