import { useEffect, useRef, type ReactNode } from "react";
import { Sparkles, X } from "lucide-react";

/**
 * The one composer shared by every mode: prompt, main controls, Generate/Cancel. `dock` is the mobile bottom sheet
 * (collapsed = prompt + chips + Generate), `pane` is the desktop left pane. It never covers the result.
 */
export function Composer({
  layout,
  prompt,
  onPrompt,
  placeholder,
  controls,
  running,
  disabled,
  disabledReason,
  error,
  onGenerate,
  onCancel,
  onExpand,
  generateIcon = <Sparkles size={20} strokeWidth={1.7} />,
}: {
  layout: "dock" | "pane";
  prompt: string;
  onPrompt: (v: string) => void;
  placeholder: string;
  controls: ReactNode;
  running: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  error?: string | null;
  onGenerate: () => void;
  onCancel: () => void;
  /** dock only: swipe up on the handle / tap it to open Advanced */
  onExpand?: () => void;
  generateIcon?: ReactNode;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const grab = useRef<number | null>(null);
  const dock = layout === "dock";

  // Auto-grow the prompt up to a cap.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    const cap = dock ? 132 : 220;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? "auto" : "hidden";
  }, [prompt, dock]);

  return (
    <div
      className={
        dock
          ? "safe-b relative z-10 flex-none rounded-t-[24px] border-t border-line bg-surface px-3.5 pb-3 pt-2 shadow-[0_-10px_30px_rgba(0,0,0,0.25)]"
          : "flex min-h-0 flex-1 flex-col gap-3"
      }
    >
      {dock && (
        <div
          className="touch-none pb-2"
          onPointerDown={(e) => {
            grab.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            const dy = grab.current === null ? 0 : e.clientY - grab.current;
            grab.current = null;
            if (dy < -32 || Math.abs(dy) < 6) onExpand?.();
          }}
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" role="button" aria-label="Open advanced settings" />
        </div>
      )}
      <textarea
        ref={area}
        value={prompt}
        onChange={(e) => onPrompt(e.target.value)}
        placeholder={placeholder}
        rows={dock ? 2 : 4}
        aria-label="Prompt"
        maxLength={8000}
        className="w-full resize-none rounded-m border border-line bg-raised px-3 py-2.5 text-[15px] leading-snug text-text outline-none focus:border-gold"
      />
      <div className={dock ? "" : "min-h-0 flex-1 overflow-y-auto"}>{controls}</div>
      {error && (
        <p role="alert" className="mb-2 rounded-s border border-danger/40 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className={dock ? "mt-2" : "flex-none pt-1"}>
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-line-strong bg-raised text-[16px] font-semibold text-text"
          >
            <X size={20} strokeWidth={1.7} /> Cancel
            {!dock && <kbd className="rounded-md border border-line-strong px-1.5 font-mono text-[11px] text-text-2">Esc</kbd>}
          </button>
        ) : (
          <button
            type="button"
            onClick={onGenerate}
            disabled={disabled}
            title={disabledReason ?? undefined}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-gold-hi to-gold text-[16px] font-semibold text-on-gold shadow-[0_6px_20px_color-mix(in_srgb,var(--gold)_30%,transparent)] transition-opacity disabled:opacity-50"
          >
            {generateIcon} Generate
            {!dock && <kbd className="rounded-md border border-black/20 px-1.5 font-mono text-[11px] opacity-70">Ctrl+Enter</kbd>}
          </button>
        )}
        {disabledReason && <p className="mt-1.5 text-center text-[12px] text-text-3">{disabledReason}</p>}
      </div>
    </div>
  );
}
