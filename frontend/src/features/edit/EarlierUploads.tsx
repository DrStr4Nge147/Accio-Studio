import { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { deleteUpload, fetchUploads, type UploadedImage } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { inputUrl } from "../../api/upload";
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
  const limit = recallLimit(mode);

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setMsg(null);
    setItems(null);
    fetchUploads().then(setItems).catch(() => setMsg("Couldn't load the earlier uploads."));
  }, [open]);

  const toggle = (file: string) =>
    setPicked((p) => (p.includes(file) ? p.filter((f) => f !== file) : limit <= 1 ? [file] : p.length < limit ? [...p, file] : p));

  const remove = async (u: UploadedImage) => {
    if (!window.confirm("Delete this uploaded image? It can't be used again, and old edits can no longer show it as their original.")) return;
    try {
      await deleteUpload(u.file);
      forgetUploaded(u.file);
      setItems((l) => l && l.filter((x) => x.file !== u.file));
      setPicked((p) => p.filter((f) => f !== u.file));
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Couldn't delete that image.");
    }
  };

  const use = async () => {
    const chosen = (items ?? []).filter((u) => picked.includes(u.file));
    const problem = await recallUploads(mode, chosen);
    useEditSubmit.getState().setError(problem);
    if (!problem) onClose();
    else setMsg(problem);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Earlier uploads" desktopModalWidth={720}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        {msg && <p className="text-[13px] text-danger">{msg}</p>}
        {items && items.length === 0 && <p className="text-[14px] text-text-3">Nothing uploaded yet. Images you choose for editing are kept here.</p>}
        <ul className="grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
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
                  onClick={() => void remove(u)}
                  className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          disabled={!picked.length}
          onClick={() => void use()}
          className="h-12 shrink-0 rounded-full bg-gold px-5 text-[15px] font-semibold text-on-gold disabled:opacity-50"
        >
          {picked.length > 1 ? `Use ${picked.length} images` : "Use this image"}
        </button>
      </div>
    </Sheet>
  );
}
