import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Loader2, Sparkles, X } from "lucide-react";
import { useMedia } from "../lib/useMedia";
import { applyTag, detectTagTrigger, type TagTrigger } from "../lib/tagSuggest";

/** One image the prompt can refer to as <imageN> (Multi-edit). */
export interface ImageTag {
  n: number;
  name: string;
  thumb: string;
}

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
  cancelling,
  disabled,
  disabledReason,
  error,
  onGenerate,
  onCancel,
  onExpand,
  above,
  tags,
  fieldHeader,
  collapse,
  generateIcon = <Sparkles size={20} strokeWidth={1.7} />,
}: {
  layout: "dock" | "pane";
  prompt: string;
  onPrompt: (v: string) => void;
  placeholder: string;
  controls: ReactNode;
  running: boolean;
  /** a cancel was requested and has not taken effect yet */
  cancelling?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  error?: string | null;
  onGenerate: () => void;
  onCancel: () => void;
  /** dock only: swipe up on the handle / tap it to open Advanced */
  onExpand?: () => void;
  /** pane only: rendered at the top of the scrolling area (the mode nav) */
  above?: ReactNode;
  /** images the prompt can refer to: typing `<`, `im` or `image` suggests <image1>, <image2>... */
  tags?: ImageTag[];
  /** shown just above the prompt box (e.g. the switch between your prompt and the enhanced one) */
  fieldHeader?: ReactNode;
  /** makes the prompt (and its header) foldable; folded, a one-line row stands in for it */
  collapse?: { collapsed: boolean; onToggle: () => void; label: string; hint: string };
  generateIcon?: ReactNode;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const grab = useRef<number | null>(null);
  const dock = layout === "dock";
  const short = useMedia("(max-height: 700px)"); // small phones: the dock must leave room for the image
  const [trig, setTrig] = useState<TagTrigger | null>(null);
  const [active, setActive] = useState(0);
  const options = trig && tags ? tags.filter((t) => String(t.n).startsWith(trig.digits)) : [];
  const open = options.length > 0;

  const refresh = (el: HTMLTextAreaElement) => {
    setTrig(tags?.length ? detectTagTrigger(el.value, el.selectionStart) : null);
    setActive(0);
  };
  const accept = (n: number) => {
    const el = area.current;
    if (!el || !trig) return;
    const r = applyTag(el.value, trig, n);
    onPrompt(r.text);
    setTrig(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") setActive((a) => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    else if (e.key === "Enter" || e.key === "Tab") accept(options[Math.min(active, options.length - 1)]!.n);
    else if (e.key === "Escape") setTrig(null);
    else return;
    e.preventDefault();
    e.stopPropagation(); // Enter would add a line, Escape would cancel the running job
  };

  // Auto-grow the prompt up to a cap.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    const cap = dock ? (short ? 44 : 64) : 220; // long prompts scroll inside the box instead of squeezing the image
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? "auto" : "hidden";
  }, [prompt, dock, short, collapse?.collapsed]);

  const handle = (
    <div
      className="touch-none pb-1.5 [@media(max-height:700px)]:pb-1"
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
      <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" role="button" aria-label="Open advanced settings" data-tip="Open advanced settings" />
    </div>
  );

  const field = (
    <div className="relative">
      <textarea
        ref={area}
        value={prompt}
        onChange={(e) => {
          onPrompt(e.target.value);
          refresh(e.target);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key) && refresh(e.currentTarget)}
        onClick={(e) => refresh(e.currentTarget)}
        onBlur={() => setTrig(null)}
        placeholder={placeholder}
        rows={dock ? (short ? 1 : 2) : 4}
        aria-label="Prompt"
        aria-autocomplete={tags ? "list" : undefined}
        maxLength={8000}
        className="w-full resize-none rounded-m border border-line bg-raised px-3 py-2.5 text-[15px] leading-snug text-text outline-none focus:border-gold"
      />
      {open && (
        <ul role="listbox" aria-label="Images to refer to" className={`absolute inset-x-0 z-30 max-h-56 overflow-y-auto rounded-m border border-line-strong bg-overlay p-1 shadow-xl ${dock ? "bottom-full mb-1.5" : "top-full mt-1"}`}>
          {options.map((o, i) => (
            <li key={o.n} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mouse down, not click: the textarea must not lose focus (its blur closes this list)
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(o.n);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left ${i === active ? "bg-raised text-text" : "text-text-2"}`}
              >
                <img src={o.thumb} alt="" className="h-8 w-8 flex-none rounded-md object-cover" />
                <span className="font-mono text-[13px] text-gold-text">{`<image${o.n}>`}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-text-3">{o.n === 1 ? `Base · ${o.name}` : o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const folded = !!collapse?.collapsed;
  const foldRow = collapse && (
    <button
      type="button"
      onClick={collapse.onToggle}
      aria-expanded={!folded}
      className="hover-wash flex min-h-11 w-full items-center gap-2 rounded-m border border-line bg-raised px-3 text-left"
    >
      <span className="flex-none text-[13px] font-medium text-text-2">{collapse.label}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-text-3">{folded ? prompt.trim() || collapse.hint : ""}</span>
      <ChevronDown size={16} strokeWidth={1.7} className={`flex-none text-text-3 transition-transform ${folded ? "" : "rotate-180"}`} />
    </button>
  );
  const promptBlock = (
    <>
      {foldRow}
      {!folded && (
        <>
          {fieldHeader}
          {field}
        </>
      )}
    </>
  );

  const problem = error && (
    <p role="alert" className="mb-2 rounded-s border border-danger/40 px-3 py-2 text-[13px] text-danger">
      {error}
    </p>
  );

  const action = (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={disabled}
          title={disabledReason ?? undefined}
          className="flex h-[52px] min-w-0 flex-1 [@media(max-height:700px)]:h-12 items-center justify-center gap-2 rounded-2xl px-4 bg-gradient-to-b from-gold-hi to-gold text-[16px] font-semibold text-on-gold shadow-[0_6px_20px_color-mix(in_srgb,var(--gold)_30%,transparent)] transition-[opacity,filter] hover:brightness-105 disabled:opacity-50"
        >
          {generateIcon} {running ? "Add to queue" : "Generate"}
          {!dock && !running && <kbd className="rounded-md border border-black/20 px-1.5 font-mono text-[11px] opacity-70">Ctrl+Enter</kbd>}
        </button>
        {running && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            aria-busy={cancelling}
            aria-label={cancelling ? "Cancelling" : "Cancel the current job"}
            data-tip={cancelling ? "Cancelling…" : "Cancel the current job (Esc)"}
            className="hover-wash flex h-[52px] w-[52px] flex-none [@media(max-height:700px)]:h-12 [@media(max-height:700px)]:w-12 items-center justify-center rounded-2xl border border-line-strong bg-raised text-text"
          >
            {cancelling ? <Loader2 size={20} strokeWidth={1.7} className="animate-spin motion-reduce:animate-none" /> : <X size={20} strokeWidth={1.7} />}
          </button>
        )}
      </div>
      {disabledReason && <p className="mt-1.5 text-center text-[12px] text-text-3">{disabledReason}</p>}
    </>
  );

  if (dock) {
    return (
      <div className="safe-b relative z-10 flex-none rounded-t-[24px] border-t border-line bg-surface px-3.5 pb-3 pt-2 [@media(max-height:700px)]:pb-2 shadow-[0_-10px_30px_rgba(0,0,0,0.25)]">
        {handle}
        <div className={collapse ? "space-y-2" : undefined}>{promptBlock}</div>
        {controls}
        {problem}
        <div className="mt-2">{action}</div>
      </div>
    );
  }

  // Pane: the nav, prompt and controls scroll together; Generate stays pinned below.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 pt-3.5">
        {above}
        {promptBlock}
        {controls}
      </div>
      <div className="flex-none border-t border-line px-4 pb-4 pt-3">
        {problem}
        {action}
      </div>
    </div>
  );
}
