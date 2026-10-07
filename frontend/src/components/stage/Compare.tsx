import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Zoomable, type ZoomTool } from "./Zoomable";

const glass = "bg-[rgba(10,9,14,0.62)] text-[#f1eadb] border border-white/10 backdrop-blur-md";
const GRAB = 32; // px around the divider that grabs it

/**
 * Before / after slider with zoom and pan. Drag the divider (or use its arrow keys) to compare; when zoomed in, drag anywhere
 * else to pan. Wheel / pinch zoom and + - 0 work as in the normal viewer. Fills its positioned parent.
 */
export function Compare({ before, after }: { before: string; after: string }) {
  const area = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);

  const tool = useMemo<ZoomTool>(() => {
    const set = (clientX: number) => {
      const r = area.current!.getBoundingClientRect(); // includes the zoom transform
      setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
    };
    return {
      // Unzoomed there is nothing to pan, so a press anywhere moves the divider; zoomed, only a press on the divider does.
      accepts: (e, k) => {
        if (k <= 1.005) return true;
        const l = line.current?.getBoundingClientRect();
        return !!l && Math.abs(e.clientX - (l.left + l.width / 2)) <= GRAB;
      },
      down: (e) => set(e.clientX),
      move: (e) => set(e.clientX),
      up: () => undefined,
      cancel: () => undefined,
    };
  }, []);

  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 3;
    if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - step));
    else if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + step));
    else if (e.key === "Home") setPos(0);
    else if (e.key === "End") setPos(100);
    else return;
    e.preventDefault();
    e.stopPropagation(); // arrows would otherwise pan a zoomed view
  };

  return (
    <>
      <Zoomable tool={tool} cursor="ew-resize">
        <div ref={area} className="absolute inset-0 select-none">
          <img src={after} alt="After" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
          <img src={before} alt="Before" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
          <div ref={line} className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${pos}%` }}>
            <span
              role="slider"
              tabIndex={0}
              aria-label="Before and after divider. Arrow keys move it."
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pos)}
              onKeyDown={key}
              className="pointer-events-auto absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white font-mono text-[12px] text-black shadow outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              ⇆
            </span>
          </div>
        </div>
      </Zoomable>
      <span className={`${glass} pointer-events-none absolute left-1/2 top-2.5 z-[3] -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-medium`}>Before ◂ ▸ After</span>
    </>
  );
}
