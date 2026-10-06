import { useEffect, useState } from "react";

type Health = { comfy_online: boolean; missing_models: string[] };

// Phase 1 shell: proves the build, the /api proxy and ComfyUI detection. The real UI comes after design approval.
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject()))
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold">Accio Studio</h1>
      <p className="opacity-70">
        {failed
          ? "Can't reach the Accio server."
          : !health
            ? "Connecting…"
            : health.comfy_online
              ? health.missing_models.length
                ? `ComfyUI is online, ${health.missing_models.length} required model(s) missing.`
                : "ComfyUI is online. All required models found."
              : "ComfyUI is offline."}
      </p>
    </main>
  );
}
