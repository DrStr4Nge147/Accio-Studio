import { useEffect, useRef, useState } from "react";

interface Shown {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

const DELAY = 380; // ms before the first tip; moving between tips is instant
const GRACE = 400;
const ID = "app-tooltip";

/**
 * One tooltip for the whole app, driven by `data-tip="..."` attributes (hover and keyboard focus; touch screens have
 * no hover, so anything essential is also written out in the interface). Nothing wraps the target, so layouts are
 * untouched. The tip is described to screen readers through aria-describedby while it is visible.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Shown | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const target = useRef<HTMLElement | null>(null);
  const lastHide = useRef(0);

  useEffect(() => {
    const find = (n: EventTarget | null) => (n instanceof Element ? (n.closest("[data-tip]") as HTMLElement | null) : null);

    const hide = () => {
      clearTimeout(timer.current);
      target.current?.removeAttribute("aria-describedby");
      if (target.current) lastHide.current = performance.now();
      target.current = null;
      setTip(null);
    };

    const show = (t: HTMLElement) => {
      const text = t.dataset.tip;
      if (!text) return;
      const r = t.getBoundingClientRect();
      const below = r.top < 64; // not enough room above: go underneath
      target.current = t;
      t.setAttribute("aria-describedby", ID);
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
    };

    const schedule = (t: HTMLElement, instant: boolean) => {
      if (t === target.current) return;
      hide();
      const quick = instant || performance.now() - lastHide.current < GRACE;
      timer.current = window.setTimeout(() => show(t), quick ? 0 : DELAY);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const t = find(e.target);
      if (t) schedule(t, false);
      else hide();
    };
    const onFocus = (e: FocusEvent) => {
      const t = find(e.target);
      // Keyboard focus only: a mouse click also focuses, and the tip is hidden on press anyway.
      if (t && (e.target as HTMLElement).matches(":focus-visible")) schedule(t, true);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();

    document.addEventListener("pointerover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      clearTimeout(timer.current);
    };
  }, []);

  // Keep the bubble inside the window horizontally once its width is known.
  useEffect(() => {
    const node = el.current;
    if (!tip || !node) return;
    const w = node.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, tip.x - w / 2));
    node.style.left = `${left}px`;
    node.style.visibility = "visible";
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={el}
      id={ID}
      role="tooltip"
      style={{ top: tip.y, left: tip.x, visibility: "hidden", transform: `translateY(${tip.below ? "8px" : "calc(-100% - 8px)"})` }}
      className="fade-in pointer-events-none fixed z-[60] max-w-[260px] rounded-s border border-line-strong bg-overlay px-2.5 py-1.5 text-[12px] leading-snug text-text shadow-float"
    >
      {tip.text}
    </div>
  );
}
