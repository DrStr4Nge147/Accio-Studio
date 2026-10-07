import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { Job } from "../../api/types";
import { Segmented } from "../../components/ui/controls";
import { enhancedText } from "../../lib/jobView";
import { useJobs } from "../../store/jobs";
import { showEnhanced, showOwn, useEnhancedView, type EnhancedMode } from "./enhanced";
import { useEdit } from "./store";
import { useWorkspace } from "./workspace";

/**
 * Above the prompt box (Multi-edit and Inpaint): switch between your own prompt and the rewrite the enhancer made on a
 * previous run. The rewrite is editable and copyable, and generating with it skips the enhancer, which is the slow part.
 *
 * It is offered only where it belongs: for the result you have open, or for the latest run made from the images / image that
 * are in the editor right now (so a blank canvas, or a new image, has none), and only for runs that really used the enhancer.
 */
export function EnhancedSwitch({ mode }: { mode: EnhancedMode }) {
  const slotFiles = useWorkspace((s) => s.slots.map((x) => x.file ?? "").join("|"));
  const inpaintUrl = useWorkspace((s) => s.inpaint.src?.url);
  const before = useWorkspace((s) => s.before);
  const fromHere = (j: Job) =>
    mode === "multiedit"
      ? slotFiles.replace(/\|/g, "") !== "" && ((j.params.images as { file: string }[] | undefined) ?? []).map((i) => i.file).join("|") === slotFiles
      : !!inpaintUrl && before[j.id] === inpaintUrl;
  const latest = useJobs((s) => {
    const sel = s.selectedId ? s.jobs[s.selectedId] : undefined;
    if (sel && sel.mode === mode && enhancedText(sel)) return sel;
    return s.order.map((id) => s.jobs[id]!).find((j) => j.mode === mode && j.status === "done" && !!enhancedText(j) && fromHere(j));
  });
  const shown = useEnhancedView((s) => s.active[mode]);
  const enhancerOn = useEdit((s) => s.enhancer[mode]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const text = latest ? enhancedText(latest) : null;
  // While the rewrite is in the box the switch stays, even if the picture it came from is gone, so you can always go back.
  const rewrite = latest && text ? { id: latest.id, text } : shown;
  if (!rewrite) return null;
  const active = !!shown;

  return (
    <div className="mb-2 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Segmented<"own" | "enhanced">
          small
          label="Which prompt to show"
          value={active ? "enhanced" : "own"}
          onChange={(v) => (v === "enhanced" ? showEnhanced(mode, rewrite) : showOwn(mode, rewrite))}
          options={[
            { value: "own", label: "Your prompt", tip: "The prompt you typed" },
            { value: "enhanced", label: "Enhanced", tip: "The rewrite the Prompt enhancer made on a previous run" },
          ]}
        />
        {active && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(useEdit.getState().prompts[mode]).catch(() => undefined);
              setCopied(true);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setCopied(false), 1500);
            }}
            className="hover-wash flex h-9 flex-none items-center gap-1.5 rounded-full px-3 text-[12px] text-gold-text"
          >
            <Copy size={14} strokeWidth={1.7} /> {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {active && (
        <p className="text-[12px] leading-snug text-text-3">
          {enhancerOn
            ? "The Prompt enhancer is on, so it will rewrite this text again. Turn it off to use the text as it is."
            : "The enhancer's rewrite from a previous run. You can edit it. Generate uses it as it is, so the enhancer does not run again."}
        </p>
      )}
    </div>
  );
}
