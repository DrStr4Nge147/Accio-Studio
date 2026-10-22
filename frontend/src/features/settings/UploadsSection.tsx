import { useState } from "react";
import { clearUploads } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { Label } from "../../components/ui/controls";

const btn = "hover-wash h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text disabled:opacity-50";

/** Frees disk space: removes the source images uploaded for Edit, from Accio's own folder and from the backend's input folder. */
export function UploadsSection() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const clear = async () => {
    const ok = window.confirm(
      "This deletes every image you uploaded for editing.\n\nResults in your gallery are kept, but the original photo of an old edit can no longer be shown or reused.\n\nContinue?",
    );
    if (!ok) return;
    setMsg(null);
    setBusy(true);
    try {
      const { removed } = await clearUploads();
      setMsg({ ok: true, text: removed ? "Uploads cleared." : "There were no uploads to clear." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Label>Uploads</Label>
      <p className="mt-1 text-[12px] text-text-3">Images you upload are kept so old edits can show their original. Clear them to free disk space.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className={btn} disabled={busy} onClick={() => void clear()}>
          {busy ? "Clearing…" : "Clear uploads"}
        </button>
        {msg && <span className={`text-[13px] ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
