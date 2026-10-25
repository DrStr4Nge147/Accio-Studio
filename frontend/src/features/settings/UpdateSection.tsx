import { useEffect, useState } from "react";
import { applyUpdate, fetchUpdate, type UpdateInfo } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { SectionTitle } from "../../components/ui/SettingsCard";
import { updateView } from "../../lib/updateView";

const btn = "hover-wash h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text disabled:opacity-50";

/** Installed version, and whether a newer release exists. "Update now" opens Update.bat on the PC (it stops Accio, so only that PC's own browser may use it). */
export function UpdateSection({ open }: { open: boolean }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = (refresh: boolean) => {
    setBusy(true);
    return fetchUpdate(refresh)
      .then((i) => setInfo(i))
      .catch(() => setMsg("Can't check for updates right now."))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (open) void load(false);
  }, [open]);

  if (!info) return msg ? <p className="text-[13px] text-text-3">{msg}</p> : null;
  const view = updateView(info);

  const update = async () => {
    const ok = window.confirm(
      `Update Accio to ${info.latest}?\n\nAccio will close and an update window opens. When it says Done, start Accio again with Run_Accio.bat. Your history, password and models are kept.`,
    );
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      await applyUpdate();
      setStarted(true);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionTitle>Updates</SectionTitle>
      <div className="mt-1.5 rounded-m border border-line p-3 [[data-card-body]_&]:mt-0 [[data-card-body]_&]:rounded-none [[data-card-body]_&]:border-0 [[data-card-body]_&]:p-0">
        <p className="text-[14px] text-text">{view.title}</p>
        {started ? (
          <p className="mt-2 text-[12px] text-text-3">
            The update window is open. Accio will close; when the window says Done, start Accio again with Run_Accio.bat.
          </p>
        ) : (
          <>
            {view.hint && <p className="mt-1 text-[12px] text-text-3">{view.hint}</p>}
            {msg && <p className="mt-1 text-[12px] text-danger">{msg}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {view.canApply && (
                <button type="button" className={btn} disabled={busy} onClick={() => void update()}>
                  Update now
                </button>
              )}
              {view.canRecheck && (
                <button type="button" className={btn} disabled={busy} onClick={() => void load(true)}>
                  Check again
                </button>
              )}
              {view.showNotes && info.notes_url && (
                <a className="text-[13px] text-text-2 underline" href={info.notes_url} target="_blank" rel="noreferrer">
                  What's new
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
