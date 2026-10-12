import { useCallback, useEffect, useRef, useState } from "react";
import { fetchModelPaths, pickFolder, saveModelPaths, type ModelPaths, type ModelPathValues } from "../../api/endpoints";
import { ApiError } from "../../api/http";
import { inputCls, Label } from "../../components/ui/controls";
import { useServer } from "../../store/health";
import { FolderBrowser } from "./FolderBrowser";

const btn = "hover-wash h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text disabled:opacity-50";

const valuesOf = (m: ModelPaths): ModelPathValues =>
  Object.fromEntries(m.families.map((f) => [f.id, Object.fromEntries(f.fields.map((x) => [x.kind, x.path]))]));

/** Use models that already sit on this PC (another ComfyUI, another app). Saving restarts the backend so it sees them. */
export function ModelFoldersSection({ open }: { open: boolean }) {
  const [data, setData] = useState<ModelPaths | null>(null);
  const [values, setValues] = useState<ModelPathValues>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string | null>(null); // the field whose Windows dialog is open on the PC
  const timer = useRef<number | undefined>(undefined);
  const { refreshHealth, refreshCatalog } = useServer();

  const load = useCallback(async () => {
    const m = await fetchModelPaths();
    setData(m);
    return m;
  }, []);

  useEffect(() => {
    if (!open) return;
    void load()
      .then((m) => {
        setValues(valuesOf(m));
        if (m.restart.state === "restarting") setBusy(true);
      })
      .catch(() => setData(null));
  }, [open, load]);

  // While the backend restarts, ask every 2 s whether it is back.
  useEffect(() => {
    if (!busy || !open) return;
    const tick = async () => {
      try {
        const m = await load();
        if (m.restart.state === "restarting") {
          timer.current = window.setTimeout(() => void tick(), 2000);
          return;
        }
        setBusy(false);
        setMsg({ ok: m.restart.state === "ready", text: m.restart.message });
        void refreshHealth();
        void refreshCatalog();
      } catch {
        timer.current = window.setTimeout(() => void tick(), 2000);
      }
    };
    timer.current = window.setTimeout(() => void tick(), 2000);
    return () => window.clearTimeout(timer.current);
  }, [busy, open, load, refreshHealth, refreshCatalog]);

  if (!data) return null;
  if (!data.available) {
    return (
      <div>
        <Label>Model folders</Label>
        <p className="mt-1.5 text-[13px] text-text-3">This app uses an external backend, so its model folders are set up there.</p>
      </div>
    );
  }

  const saved = valuesOf(data);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  const save = async () => {
    const ok = window.confirm(
      "Saving restarts the backend so it can see these folders. Any image that is generating right now will stop.\n\nContinue?",
    );
    if (!ok) return;
    setMsg(null);
    setBusy(true);
    try {
      await saveModelPaths(values);
      await load();
    } catch (err) {
      setBusy(false);
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    }
  };

  return (
    <div>
      <Label>Model folders</Label>
      <p className="mt-1 text-[12px] text-text-3">
        Already have models from ComfyUI or another app? Enter the folder that holds each one. Nothing in them is moved, copied or changed. Leave a
        field empty to use the app's own folder.
      </p>
      <div className="mt-2 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {data.families.map((fam) => (
          <fieldset key={fam.id} className="rounded-m border border-line p-3" disabled={busy}>
            <legend className="px-1 text-[13px] font-medium text-text">{fam.label}</legend>
            <div className="space-y-2.5">
              {fam.fields.map((f) => {
                const id = `mf-${fam.id}-${f.kind}`;
                const current = values[fam.id]?.[f.kind] ?? "";
                return (
                  <div key={f.kind}>
                    <label htmlFor={id} className="text-[12px] text-text-2">
                      {f.label}
                    </label>
                    <div className="mt-0.5 flex gap-2">
                      <input
                        id={id}
                        className={`${inputCls} min-w-0 flex-1 font-mono text-[12px]`}
                        value={current}
                        placeholder={`Default: ${f.default}`}
                        title={f.default}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setValues((v) => ({ ...v, [fam.id]: { ...v[fam.id], [f.kind]: e.target.value } }))}
                      />
                      {data.can_pick && (
                        <button
                          type="button"
                          className={`${btn} shrink-0 px-3`}
                          disabled={dialog !== null}
                          title="Opens Windows' folder window on this PC"
                          onClick={() => {
                            setDialog(id);
                            setMsg(null);
                            pickFolder(current)
                              .then(({ path }) => path && setValues((v) => ({ ...v, [fam.id]: { ...v[fam.id], [f.kind]: path } })))
                              .catch((err) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." }))
                              .finally(() => setDialog(null));
                          }}
                        >
                          {dialog === id ? "Choose in the window…" : "Browse on this PC"}
                        </button>
                      )}
                      <button type="button" className={`${btn} shrink-0 px-3`} onClick={() => setPicking(picking === id ? null : id)}>
                        {data.can_pick ? "List" : "Browse"}
                      </button>
                    </div>
                    {picking === id && (
                      <FolderBrowser
                        start={current}
                        onClose={() => setPicking(null)}
                        onPick={(path) => {
                          setValues((v) => ({ ...v, [fam.id]: { ...v[fam.id], [f.kind]: path } }));
                          setPicking(null);
                        }}
                      />
                    )}
                    {f.path && (
                      <p className={`mt-0.5 text-[12px] ${f.missing ? "text-danger" : "text-ok"}`}>
                        {f.missing ? "Folder not found." : `${f.found} model file${f.found === 1 ? "" : "s"} found.`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="h-11 rounded-full bg-gold px-5 text-[14px] font-semibold text-on-gold disabled:opacity-50"
        >
          {busy ? "Restarting the backend…" : "Save and restart backend"}
        </button>
        {dirty && !busy && (
          <button type="button" className={btn} onClick={() => setValues(saved)}>
            Undo
          </button>
        )}
      </div>
      {msg && (
        <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-ok" : "text-danger"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
