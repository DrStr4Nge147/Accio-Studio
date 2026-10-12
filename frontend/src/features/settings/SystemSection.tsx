import { useEffect, useState } from "react";
import { fetchSystem, type SystemInfo } from "../../api/endpoints";
import { Label } from "../../components/ui/controls";

const gb = (mb: number) => `${Math.round(mb / 1024)} GB`;

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

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    fetchSystem().then(setInfo).catch(() => setFailed(true));
  }, [open]);

  const nvidia = !!info?.driver_cuda || !!info?.gpus.some((g) => /nvidia/i.test(g.name));
  const cuda = (v: string | null) => v ?? (nvidia ? "Not available" : "Not applicable");

  if (!info) return failed ? <p className="text-[13px] text-text-3">Can't read this PC's hardware right now.</p> : null;

  return (
    <div>
      <Label>This PC</Label>
      <div className="mt-1.5 divide-y divide-line rounded-m border border-line px-3">
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
      </div>
    </div>
  );
}
