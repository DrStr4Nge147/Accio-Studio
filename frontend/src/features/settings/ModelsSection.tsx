import { useCallback, useEffect, useRef, useState } from "react";
import { cancelModelDownload, downloadModels, fetchModels, type ModelRow, type ModelsData } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { Label } from "../../components/ui/controls";
import { formatSize, groupModels, isHave, missingIds, percent, stateText, summary } from "../../lib/modelsView";
import { useServer } from "../../store/health";

const btn = "hover-wash h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text disabled:opacity-50";
const smallBtn = "hover-wash h-9 rounded-full border border-line-strong px-3 text-[13px] text-text-2 hover:text-text disabled:opacity-50";

/** Download the models Accio needs, one card per group. A download keeps running on the PC when this page is closed. */
export function ModelsSection({ open }: { open: boolean }) {
  const [data, setData] = useState<ModelsData | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const wasRunning = useRef(false);
  const { refreshHealth, refreshCatalog } = useServer();

  const load = useCallback(async () => {
    const d = await fetchModels();
    setData(d);
    return d;
  }, []);

  const running = data?.job.state === "running";

  useEffect(() => {
    if (open) void load().catch(() => setData(null));
  }, [open, load]);

  // While a job runs, look again every 1.5 s. When it ends, the rest of the app learns the models are there.
  useEffect(() => {
    if (!open || !running) {
      if (wasRunning.current && data && !running) {
        wasRunning.current = false;
        void refreshHealth();
        void refreshCatalog();
        if (data.job.state === "done") setMsg({ ok: true, text: "Download finished." });
        else if (data.job.message) setMsg({ ok: data.job.state === "cancelled", text: data.job.message });
      }
      return;
    }
    wasRunning.current = true;
    timer.current = window.setTimeout(() => void load().catch(() => undefined), 1500);
    return () => window.clearTimeout(timer.current);
  }, [open, running, data, load, refreshHealth, refreshCatalog]);

  if (!data) return null;
  if (!data.available) {
    return (
      <div>
        <Label>Models</Label>
        <p className="mt-1.5 text-[13px] text-text-3">This app uses an external backend, so its models are managed there.</p>
      </div>
    );
  }

  const start = async (ids: string[]) => {
    setMsg(null);
    setBusy(true);
    try {
      await downloadModels(ids);
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await cancelModelDownload();
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const requiredMissing = missingIds(data.models.filter((m) => m.required));

  return (
    <div>
      <Label>Models</Label>
      <p className="mt-1 text-[12px] text-text-3">
        {summary(data)} Free space on the models drive: {formatSize(data.free_bytes)}. Stopping keeps what is already downloaded; the next download continues from
        there.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {running ? (
          <button type="button" className={btn} disabled={busy} onClick={() => void stop()}>
            Stop downloading
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !requiredMissing.length}
            onClick={() => void start(requiredMissing)}
            className="h-11 rounded-full bg-gold px-5 text-[14px] font-semibold text-on-gold disabled:opacity-50"
          >
            Download required models
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {groupModels(data.models).map((g) => {
          const ids = missingIds(g.rows);
          return (
            <section key={g.id} className="rounded-m border border-line p-3" aria-label={g.title}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] font-medium text-text">{g.title}</h3>
                {g.id !== "required" && (
                  <button type="button" className={smallBtn} disabled={busy || running || !ids.length} onClick={() => void start(ids)}>
                    {ids.length ? "Download" : "Installed"}
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-text-3">{g.hint}</p>
              <ul className="mt-2 space-y-2.5">
                {g.rows.map((m) => (
                  <ModelItem key={m.id} m={m} disabled={busy || running} onDownload={() => void start([m.id])} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {msg && (
        <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-ok" : "text-danger"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function ModelItem({ m, disabled, onDownload }: { m: ModelRow; disabled: boolean; onDownload: () => void }) {
  const pct = percent(m);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 break-all font-mono text-[12px] text-text-2" title={m.id}>
          {m.id}
        </span>
        <span className="flex-none text-[12px] text-text-3">{formatSize(m.size)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className={`text-[12px] ${isHave(m) ? "text-ok" : m.state === "damaged" ? "text-danger" : "text-text-3"}`}>
          {stateText(m)} · {m.used_by}
        </span>
        {!isHave(m) && m.state !== "downloading" && m.state !== "queued" && (
          <button type="button" className={smallBtn} disabled={disabled} onClick={onDownload}>
            {m.state === "partial" ? "Resume" : "Download"}
          </button>
        )}
      </div>
      {pct !== null && (
        <div
          role="progressbar"
          aria-label={`${m.id} download`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div className="h-full bg-gold" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}
