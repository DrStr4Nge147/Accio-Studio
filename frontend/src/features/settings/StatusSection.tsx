import { SectionTitle } from "../../components/ui/SettingsCard";
import { useServer } from "../../store/health";
import { useJobs } from "../../store/jobs";

function Row({ k, v, ok, action }: { k: string; v: string; ok?: boolean; action?: { label: string; run: () => void } }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[14px]">
      <span className="text-text-2">{k}</span>
      <span className="flex items-center gap-2">
        {action && (
          <button type="button" onClick={action.run} className="text-[13px] text-gold-text underline-offset-2 hover:underline">
            {action.label}
          </button>
        )}
        <span className={`flex items-center gap-1.5 ${ok === undefined ? "text-text" : ok ? "text-ok" : "text-danger"}`}>
          {ok !== undefined && <i className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
          {v}
        </span>
      </span>
    </div>
  );
}

/** Is everything Accio needs running and installed? `onManageModels` jumps to where missing models are downloaded (desktop). */
export function StatusSection({ onManageModels }: { onManageModels?: () => void }) {
  const { health, unreachable } = useServer();
  const connected = useJobs((s) => s.connected);
  return (
    <div>
      <div className="divide-y divide-line rounded-m border border-line px-3 [[data-card-body]_&]:rounded-none [[data-card-body]_&]:border-0 [[data-card-body]_&]:px-0">
        <Row k="Accio server" v={unreachable ? "Unreachable" : "Running"} ok={!unreachable} />
        <Row k="Live updates" v={connected ? "Connected" : "Reconnecting…"} ok={connected} />
        <Row k="Backend server" v={!health ? "Checking…" : health.comfy_online ? `Online${health.comfy_version ? ` (v${health.comfy_version})` : ""}` : "Offline"} ok={health ? health.comfy_online : undefined} />
        {health?.comfy_online && (
          <>
            <Row
              k="Required models"
              v={health.missing_models.length ? `${health.missing_models.length} missing` : "All found"}
              ok={!health.missing_models.length}
              action={health.missing_models.length && onManageModels ? { label: "Download", run: onManageModels } : undefined}
            />
            <Row k="Components" v={health.missing_nodes.length ? `${health.missing_nodes.length} missing` : "All found"} ok={!health.missing_nodes.length} />
          </>
        )}
      </div>
      {health && health.missing_models.length > 0 && !onManageModels && (
        <div className="mt-5">
          <SectionTitle>Missing models</SectionTitle>
          <ul className="mt-1 space-y-1 font-mono text-[12px] text-text-2">
            {health.missing_models.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-text-3">Download them in the Models section below.</p>
        </div>
      )}
      {health && health.missing_nodes.length > 0 && (
        <div className="mt-5">
          <SectionTitle>Missing components</SectionTitle>
          <p className="mt-1 font-mono text-[12px] text-text-2">{health.missing_nodes.join(", ")}</p>
        </div>
      )}
      {health?.warnings.map((w) => (
        <p key={w} className="mt-3 rounded-s border border-line p-3 text-[13px] text-text-2">
          {w}
        </p>
      ))}
    </div>
  );
}
