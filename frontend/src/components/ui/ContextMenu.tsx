import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { create } from "zustand";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Asks again in place ("Click again to …") before running, for destructive items. */
  confirm?: string;
  disabled?: boolean;
  /** Draws a divider above this item. */
  separated?: boolean;
}

interface MenuState {
  at: { x: number; y: number; items: MenuItem[] } | null;
  show: (x: number, y: number, items: MenuItem[]) => void;
  close: () => void;
}

const useMenu = create<MenuState>((set) => ({
  at: null,
  show: (x, y, items) => set({ at: { x, y, items } }),
  close: () => set({ at: null }),
}));

/** `onContextMenu` handler: opens the app's menu at the pointer. Leaves the browser's own menu alone when there are no items. */
export function openContextMenu(e: MouseEvent, items: MenuItem[]) {
  if (!items.length) return;
  e.preventDefault();
  e.stopPropagation();
  useMenu.getState().show(e.clientX, e.clientY, items);
}

/** One right-click / long-press menu for the whole app; mounted once next to the tooltip layer. */
export function ContextMenuLayer() {
  const at = useMenu((s) => s.at);
  const close = useMenu((s) => s.close);
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [asked, setAsked] = useState<number | null>(null);

  useEffect(() => setAsked(null), [at]);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!at || !el.current) return;
    const r = el.current.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
    el.current.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const onDown = (e: Event) => !el.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const btns = [...(el.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLElement);
        btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("contextmenu", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [at, close]);

  if (!at) return null;
  return (
    <div
      ref={el}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fade-in fixed z-[70] min-w-48 max-w-72 rounded-m border border-line-strong bg-raised p-1 text-[14px] text-text shadow-lg"
    >
      {at.items.map((it, n) => (
        <div key={it.label}>
          {it.separated && <div role="separator" className="my-1 h-px bg-line" />}
          <button
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              if (it.confirm && asked !== n) return setAsked(n);
              close();
              it.onSelect();
            }}
            className={`hover-wash flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left disabled:opacity-40 ${it.danger ? "text-danger" : ""}`}
          >
            {it.icon}
            <span className="truncate">{asked === n && it.confirm ? it.confirm : it.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
