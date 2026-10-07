import type { ReactNode } from "react";
import { Composer } from "../../components/Composer";
import { useServer } from "../../store/health";
import { isActive, useJobs } from "../../store/jobs";
import { useUi } from "../../store/ui";
import { cancelCurrent } from "../create/actions";
import { generateEdit, useEditSubmit } from "./actions";
import { EditChips, EditToggles } from "./EditControls";
import { EnhancedSwitch } from "./EnhancedPrompt";
import { editBlocker } from "./params";
import { useEdit } from "./store";
import { useWorkspace } from "./workspace";

const PLACEHOLDERS = {
  multiedit: "Say what to change, e.g. “replace the jacket in <image1> with the one from <image2>”. Keep what should stay.",
  inpaint: "Say what should appear in the painted area. Use action words: replace, remove, add, change. Match the lighting and style.",
  outpaint: "Describe what continues into the new area. The default works as it is.",
} as const;

/** Edit's instance of the shared composer, in the layout the viewport asks for. */
export function EditComposer({ layout, above }: { layout: "dock" | "pane"; above?: ReactNode }) {
  const edit = useEdit();
  const ws = useWorkspace();
  const { busy, stage, error } = useEditSubmit();
  const running = useJobs((s) => s.order.some((id) => isActive(s.jobs[id])));
  const cancelling = useJobs((s) => s.order.some((id) => isActive(s.jobs[id]) && !!s.cancelling[id]));
  const offline = useServer((s) => s.health?.comfy_online) === false;
  const defaultPrompt = useServer((s) => s.catalog?.defaults.edit.outpaint.prompt) ?? "";
  const mode = edit.mode;
  const blocker = editBlocker(edit, ws);
  const prompt = mode === "outpaint" ? edit.prompts.outpaint || defaultPrompt : edit.prompts[mode];

  return (
    <Composer
      layout={layout}
      above={above}
      fieldHeader={mode === "outpaint" ? undefined : <EnhancedSwitch mode={mode} />}
      tags={mode === "multiedit" ? ws.slots.map((s, i) => ({ n: i + 1, name: s.name, thumb: s.url })) : undefined}
      prompt={prompt}
      onPrompt={(v) => edit.setPrompt(mode, v)}
      placeholder={PLACEHOLDERS[mode]}
      controls={layout === "dock" ? <EditChips /> : <EditToggles />}
      running={running}
      cancelling={cancelling}
      disabled={busy || !!blocker || offline}
      disabledReason={offline ? "The backend server is offline, so nothing can be generated right now." : busy ? stage : blocker}
      error={error}
      onGenerate={() => void generateEdit()}
      onCancel={() => void cancelCurrent()}
      onExpand={() => useUi.getState().set({ advancedOpen: true })}
    />
  );
}
