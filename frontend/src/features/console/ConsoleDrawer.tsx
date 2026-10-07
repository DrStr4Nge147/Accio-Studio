import { ChevronDown, ChevronUp, Copy, Eraser, Terminal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { IconButton } from "../../components/ui/controls";
import { showLine } from "../../lib/consoleLog";
import { useConsole } from "../../store/console";
import { useUi } from "../../store/ui";

/** Keep the console fresh: fast while it is open, slow while only the strip shows. */
export function useConsolePolling(active: boolean, ms: number) {
  useEffect(() => {
    if (!active) return;
    const poll = useConsole.getState().poll;
    void poll();
    const t = setInterval(() => void poll(), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

/** The ComfyUI log, scrolled to the end unless the user has scrolled up to read. */
export function ConsoleLog({ className = "" }: { className?: string }) {
  const lines = useConsole((s) => s.lines);
  const available = useConsole((s) => s.available);
  const external = useConsole((s) => s.external);
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!available)
    return (
      <p className={`px-4 py-3 text-[13px] text-text-3 ${className}`}>
        {external ? "The console isn't available when an external backend is used." : "No log yet. It appears once the backend has started."}
      </p>
    );
  return (
    <pre
      ref={ref}
      tabIndex={0}
      aria-label="ComfyUI log"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className={`overflow-auto whitespace-pre px-4 py-2 font-mono text-[12px] leading-[1.5] text-text-2 ${className}`}
    >
      {lines.map(showLine).join("\n")}
    </pre>
  );
}

export function ConsoleActions() {
  const clear = useConsole((s) => s.clear);
  return (
    <>
      <IconButton
        label="Copy log"
        className="h-8 w-8"
        onClick={() => void navigator.clipboard?.writeText(useConsole.getState().lines.map(showLine).join("\n")).catch(() => {})}
      >
        <Copy size={16} strokeWidth={1.7} />
      </IconButton>
      <IconButton label="Clear view" className="h-8 w-8" onClick={clear}>
        <Eraser size={16} strokeWidth={1.7} />
      </IconButton>
    </>
  );
}

/** Desktop: a slim strip under the canvas; the log shows only when it is expanded. */
export function ConsoleDrawer() {
  const open = useUi((s) => s.consoleOpen);
  const set = useUi((s) => s.set);
  const available = useConsole((s) => s.available);
  useConsolePolling(available || open, open ? 1000 : 3000);
  const toggle = () => set({ consoleOpen: !open });
  return (
    <section aria-label="Console" className="flex-none border-t border-line bg-surface">
      <div className="flex h-9 items-center gap-2 pl-4 pr-2">
        <button type="button" aria-expanded={open} onClick={toggle} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12px] text-text-3 hover:text-text-2">
          <Terminal size={15} strokeWidth={1.7} className="flex-none" />
          <span className="flex-none font-medium text-text-2">Console</span>
        </button>
        {open && <ConsoleActions />}
        <IconButton label={open ? "Collapse console" : "Expand console"} className="h-8 w-8" onClick={toggle}>
          {open ? <ChevronDown size={18} strokeWidth={1.7} /> : <ChevronUp size={18} strokeWidth={1.7} />}
        </IconButton>
      </div>
      {open && <ConsoleLog className="h-[260px] border-t border-line bg-bg" />}
    </section>
  );
}
