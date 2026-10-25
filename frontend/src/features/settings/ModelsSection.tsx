import { useCallback, useEffect, useRef, useState } from "react";
import { cancelModelDownload, downloadModels, fetchModels, type ModelRow, type ModelsData } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { SectionTitle } from "../../components/ui/SettingsCard";
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
        <SectionTitle>Models</SectionTitle>
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
      <SectionTitle>Models</SectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-[14px] text-text">{summary(data)}</p>
          <p className="mt-0.5 text-[12px] text-text-3">Free space on the models drive: {formatSize(data.free_bytes)}. Stopping keeps what is downloaded; the next download continues from there.</p>
        </div>
        {running ? (
          <button type="button" className={btn} disabled={busy} onClick={() => void stop()}>
            Stop downloading
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !requiredMissing.length}
            onClick={() => void start(requiredMissing)}
            className="h-11 flex-none rounded-full bg-gold px-5 text-[14px] font-semibold text-on-gold disabled:opacity-50"
          >
            Download required models
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-3">
        {groupModels(data.models).map((g) => {
          const ids = missingIds(g.rows);
          return (
            <section key={g.id} className="rounded-m border border-line bg-surface/60 p-4" aria-label={g.title}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] font-medium text-text">
                  {g.title} <span className="ml-1 font-normal text-text-3">{g.rows.filter(isHave).length}/{g.rows.length} installed</span>
                </h3>
                {g.id !== "required" && (
                  <button type="button" className={smallBtn} disabled={busy || running || !ids.length} onClick={() => void start(ids)}>
                    {ids.length ? "Download" : "Installed"}
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-text-3">{g.hint}</p>
              <ul className="mt-3 divide-y divide-line">
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
  const tone = isHave(m) ? "text-ok" : m.state === "damaged" ? "text-danger" : "text-text-3";
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="break-all font-mono text-[12.5px] text-text" title={m.id}>
            {m.id}
          </div>
          <div className="mt-0.5 text-[12px] text-text-3">
            <span className={tone}>{stateText(m)}</span> · {m.used_by} · {formatSize(m.size)}
          </div>
        </div>
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
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div className="h-full bg-gold transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
      )}
    </li>
  );
}
