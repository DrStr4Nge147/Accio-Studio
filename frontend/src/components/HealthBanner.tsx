import { useServer } from "../store/health";
import { useUi } from "../store/ui";

/** One calm line when something stops generation from working. Details live in Settings. */
export function HealthBanner() {
  const { health, unreachable, refreshHealth } = useServer();
  let text: string | null = null;
  if (unreachable) text = "Can't reach the Accio server.";
  else if (health && !health.comfy_online) text = "The backend server is offline. Start it with Run_Accio.bat, then check again.";
  else if (health?.missing_models.length) text = `${health.missing_models.length} required model${health.missing_models.length === 1 ? " is" : "s are"} missing.`;
  else if (health?.missing_nodes.length) text = "Some backend components are missing.";
  if (!text) return null;
  return (
    <div role="status" className="flex flex-none items-center justify-between gap-3 border-b border-line bg-raised px-4 py-2 text-[13px]">
      <span className="text-text-2">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-danger" />
        {text}
      </span>
      <span className="flex flex-none gap-1">
        <button type="button" onClick={() => void refreshHealth()} className="hover-wash h-11 rounded-full px-3 text-gold-text">
          Check again
        </button>
        <button type="button" onClick={() => useUi.getState().set({ settingsOpen: true })} className="hover-wash h-11 rounded-full px-3 text-text-2 hover:text-text">
          Details
        </button>
      </span>
    </div>
  );
}
