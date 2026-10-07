import { useEffect, useState } from "react";
import { fetchConnection, type Connection } from "../../api/endpoints";
import { Label } from "../../components/ui/controls";

const MODE: Record<Connection["mode"], string> = { local: "This PC", cloudflare: "Cloudflare tunnel", zrok: "zrok tunnel" };

/** Where this server can be reached, with a QR code to open it on a phone. Re-read while the sheet is open (tunnels start late). */
export function ConnectionSection({ open }: { open: boolean }) {
  const [info, setInfo] = useState<Connection | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () =>
      fetchConnection().then(
        (c) => live && (setInfo(c), setFailed(false)),
        () => live && setFailed(true),
      );
    void load();
    const t = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open]);

  if (failed && !info) return <p className="text-[13px] text-text-3">Connection details are not available right now.</p>;
  if (!info) return null;
  const waiting = info.mode !== "local" && !info.public_url;
  const thisPcOnly = info.mode === "local" && !info.urls.lan;
  return (
    <div>
      <Label>Connection</Label>
      <div className="mt-1.5 rounded-m border border-line p-3">
        <div className="flex items-center justify-between text-[14px]">
          <span className="text-text-2">Mode</span>
          <span>{MODE[info.mode]}</span>
        </div>
        <dl className="mt-2 space-y-1 text-[13px]">
          {info.public_url && <Url k="Public address" v={info.public_url} />}
          {info.urls.lan && <Url k="Same network" v={info.urls.lan} />}
          <Url k="This PC" v={info.urls.local} />
        </dl>
        {waiting && (
          <p className="mt-2 text-[12px] text-text-3">
            {info.status === "failed" ? "The tunnel could not start. See the Accio server window." : "Starting the tunnel…"}
          </p>
        )}
        {!waiting && !thisPcOnly && (
          <div className="mt-3 flex items-center gap-3">
            <img src={info.qr} alt={`QR code for ${info.qr_url}`} className="h-28 w-28 flex-none rounded-s bg-white p-1" />
            <p className="text-[12px] text-text-3">Scan with a phone camera to open Accio there, then sign in.</p>
          </div>
        )}
        {thisPcOnly && (
          <p className="mt-2 text-[12px] text-text-3">Only this PC can reach Accio now. For a phone, restart with a tunnel or the same-network option in Run_Accio.bat; the QR code appears here.</p>
        )}
      </div>
    </div>
  );
}

function Url({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="flex-none text-text-3">{k}</dt>
      <dd className="min-w-0 select-all truncate font-mono text-[12px] text-text-2">{v}</dd>
    </div>
  );
}
