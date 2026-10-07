import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Segmented } from "../../components/ui/controls";
import { useJobs } from "../../store/jobs";
import { showEnhanced, showOwn, useEnhancedView, type EnhancedMode } from "./enhanced";
import { useEdit } from "./store";

/**
 * Above the prompt box (Multi-edit and Inpaint): switch between your own prompt and the rewrite the enhancer made on the
 * last run. The rewrite is editable and copyable, and generating with it skips the enhancer, which is the slow part.
 */
export function EnhancedSwitch({ mode }: { mode: EnhancedMode }) {
  const latest = useJobs((s) => {
    const sel = s.selectedId ? s.jobs[s.selectedId] : undefined;
    if (sel && sel.mode === mode && sel.prompt_used) return sel;
    return s.order.map((id) => s.jobs[id]!).find((j) => j.mode === mode && j.status === "done" && !!j.prompt_used);
  });
  const active = useEnhancedView((s) => !!s.active[mode]);
  const enhancerOn = useEdit((s) => s.enhancer[mode]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!latest?.prompt_used) return null;
  const rewrite = { id: latest.id, text: latest.prompt_used };

  return (
    <div className="mb-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Segmented<"own" | "enhanced">
          small
          label="Which prompt to show"
          value={active ? "enhanced" : "own"}
          onChange={(v) => (v === "enhanced" ? showEnhanced(mode, rewrite) : showOwn(mode, rewrite))}
          options={[
            { value: "own", label: "Your prompt", tip: "The prompt you typed" },
            { value: "enhanced", label: "Enhanced", tip: "The rewrite the Prompt enhancer made on your last run" },
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
            className="hover-wash flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] text-gold-text"
          >
            <Copy size={14} strokeWidth={1.7} /> {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {active && (
        <p className="text-[12px] leading-snug text-text-3">
          {enhancerOn
            ? "The Prompt enhancer is on, so it will rewrite this text again. Turn it off to use the text as it is."
            : "The enhancer's rewrite from your last run. You can edit it. Generate uses it as it is, so the enhancer does not run again."}
        </p>
      )}
    </div>
  );
}
