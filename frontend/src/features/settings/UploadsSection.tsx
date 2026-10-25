import { useState } from "react";
import { clearUploads } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { SectionTitle } from "../../components/ui/SettingsCard";

const btn = "hover-wash h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text disabled:opacity-50";

/** Frees disk space: removes every image uploaded for Edit (data/uploads, which is also the backend's input folder). */
export function UploadsSection() {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const clear = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const { removed } = await clearUploads();
      setMsg({ ok: true, text: removed ? "Uploads cleared." : "There were no uploads to clear." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <div>
      <SectionTitle>Uploads</SectionTitle>
      <p className="mt-1 text-[12px] text-text-3">Images you upload are kept so you can pick them again and old edits can show their original. Clear them to free disk space.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className={btn} disabled={busy} onClick={() => setAsking(true)}>
          Clear uploads
        </button>
        {msg && <span className={`text-[13px] ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</span>}
      </div>
      <ConfirmDialog open={asking} title="Clear all uploads?" confirmLabel="Clear" busy={busy} onConfirm={() => void clear()} onCancel={() => setAsking(false)}>
        This deletes every image you uploaded for editing. Results in your gallery are kept, but the original photo of an old edit can no longer be shown or reused.
      </ConfirmDialog>
    </div>
  );
}
