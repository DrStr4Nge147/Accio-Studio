import { useEffect, useState } from "react";
import { fetchSystem, fetchTemps, type SystemInfo, type SystemTemps } from "../../api/endpoints";
import { SectionTitle } from "../../components/ui/SettingsCard";

const TEMP_POLL_MS = 4000;
const gb = (mb: number) => `${Math.round(mb / 1024)} GB`;
const deg = (c: number | null | undefined) => (c == null ? "Unavailable" : `${c} °C`);

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-[14px]">
      <span className="shrink-0 text-text-2">{k}</span>
      <span className="text-right text-text">{v}</span>
    </div>
  );
}

/** This PC's graphics card (with its memory), driver, CUDA and RAM. Hardware is fixed while Accio runs, so it loads once per open. */
export function SystemSection({ open }: { open: boolean }) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [temps, setTemps] = useState<SystemTemps | null>(null);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    fetchSystem().then(setInfo).catch(() => setFailed(true));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const poll = () => fetchTemps().then((t) => alive && setTemps(t)).catch(() => {});
    poll();
    const id = setInterval(poll, TEMP_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);

  const nvidia =!!info?.driver_cuda || !!info?.gpus.some((g) => /nvidia/i.test(g.name));
  const cuda = (v: string | null) => v ?? (nvidia ? "Not available" : "Not applicable");

  if (!info) return failed ? <p className="text-[13px] text-text-3">Can't read this PC's hardware right now.</p> : null;

  return (
    <div>
      <SectionTitle>This PC</SectionTitle>
      <div className="mt-1.5 divide-y divide-line rounded-m border border-line px-3 [[data-card-body]_&]:mt-0 [[data-card-body]_&]:rounded-none [[data-card-body]_&]:border-0 [[data-card-body]_&]:px-0">
        {info.gpus.length ? (
          info.gpus.map((g, i) => (
            <Row key={`${g.name}-${i}`} k={info.gpus.length > 1 ? `Graphics card ${i + 1}` : "Graphics card"} v={g.vram_mb ? `${g.name} · ${gb(g.vram_mb)}` : g.name} />
          ))
        ) : (
          <Row k="Graphics card" v="Not detected" />
        )}
        {info.gpus[0]?.driver && <Row k="Driver" v={info.gpus[0].driver} />}
        <Row k="CUDA (driver supports)" v={cuda(info.driver_cuda)} />
        <Row k="CUDA (engine built for)" v={cuda(info.engine_cuda)} />
        <Row k="RAM" v={info.ram_mb ? gb(info.ram_mb) : "Unknown"} />
        {temps &&
          (temps.gpus.length ? (
            temps.gpus.map((c, i) => <Row key={i} k={temps.gpus.length > 1 ? `Graphics card ${i + 1} temperature` : "Graphics card temperature"} v={deg(c)} />)
          ) : (
            <Row k="Graphics card temperature" v="Unavailable" />
          ))}
        {temps && <Row k="CPU temperature" v={deg(temps.cpu)} />}
      </div>
      {temps && temps.cpu == null && (
        <p className="mt-1.5 text-[12px] text-text-3">Windows doesn't report CPU temperature. Run LibreHardwareMonitor to see it here.</p>
      )}
    </div>
  );
}
