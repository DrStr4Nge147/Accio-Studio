import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const glass = "bg-[rgba(10,9,14,0.62)] text-[#f1eadb] border border-white/10 backdrop-blur-md";

/** Before / after slider: drag anywhere (or use the arrow keys) to move the divider. Fills its positioned parent. */
export function Compare({ before, after }: { before: string; after: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const drag = useRef(false);

  const set = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  const down = (e: PointerEvent) => {
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    set(e.clientX);
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 3;
    if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - step));
    else if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + step));
    else if (e.key === "Home") setPos(0);
    else if (e.key === "End") setPos(100);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label="Before and after. Arrow keys move the divider."
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      onPointerDown={down}
      onPointerMove={(e) => drag.current && set(e.clientX)}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
      onKeyDown={key}
      className="absolute inset-0 cursor-ew-resize touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      <img src={after} alt="After" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
      <img src={before} alt="Before" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <span className={`${glass} pointer-events-none absolute bottom-2.5 left-2.5 rounded-full px-2.5 py-1 text-[11px] font-medium`}>Before</span>
      <span className={`${glass} pointer-events-none absolute bottom-2.5 right-2.5 rounded-full px-2.5 py-1 text-[11px] font-medium`}>After</span>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${pos}%` }}>
        <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white font-mono text-[12px] text-black shadow">⇆</span>
      </div>
    </div>
  );
}
