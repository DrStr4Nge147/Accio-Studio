import type { ReactNode } from "react";
import { Composer } from "../../components/Composer";
import { useServer } from "../../store/health";
import { isActive, useJobs } from "../../store/jobs";
import { useUi } from "../../store/ui";
import { cancelCurrent, generate, useSubmit } from "./actions";
import { CreateChips, CreateToggles } from "./CreateControls";
import { useCreate } from "./store";

/** Create's instance of the shared composer, in the layout the viewport asks for. */
export function CreateComposer({ layout, above }: { layout: "dock" | "pane"; above?: ReactNode }) {
  const prompt = useCreate((s) => s.prompt);
  const patch = useCreate((s) => s.patch);
  const { busy, error } = useSubmit();
  const running = useJobs((s) => s.order.some((id) => isActive(s.jobs[id])));
  const online = useServer((s) => s.health?.comfy_online);
  const offline = online === false;

  return (
    <Composer
      layout={layout}
      above={above}
      prompt={prompt}
      onPrompt={(prompt) => patch({ prompt })}
      placeholder="Describe what to create…"
      controls={layout === "dock" ? <CreateChips /> : <CreateToggles />}
      running={running}
      disabled={busy || !prompt.trim() || offline}
      disabledReason={offline ? "ComfyUI is offline, so nothing can be generated right now." : null}
      error={error}
      onGenerate={() => void generate()}
      onCancel={() => void cancelCurrent()}
      onExpand={() => useUi.getState().set({ advancedOpen: true })}
    />
  );
}
