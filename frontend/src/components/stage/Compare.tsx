import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Zoomable, type ViewInfo, type ZoomTool } from "./Zoomable";

const glass = "bg-[rgba(10,9,14,0.62)] text-[#f1eadb] border border-white/10 backdrop-blur-md";
const FIT: ViewInfo = { k: 1, x: 0, y: 0, w: 0, h: 0 };

/**
 * Before / after slider with zoom and pan. The divider stays where you put it on screen while the pictures zoom and pan
 * underneath it, so it never leaves the view: zoom in on a detail and drag the divider across it. Drag the handle (or use its
 * arrow keys) to move it; unzoomed, a press anywhere moves it; zoomed, drag the picture to pan. Fills its positioned parent.
 */
export function Compare({ before, after }: { before: string; after: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50); // divider position, % of the viewing box (screen space)
  const [view, setView] = useState<ViewInfo>(FIT);
  const drag = useRef(false);

  const setFrom = (clientX: number) => {
    const r = root.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  // Unzoomed there is nothing to pan, so a press anywhere on the picture moves the divider. Zoomed, only the handle does.
  const tool = useMemo<ZoomTool>(
    () => ({ accepts: (_e, k) => k <= 1.005, down: (e) => setFrom(e.clientX), move: (e) => setFrom(e.clientX), up: () => undefined, cancel: () => undefined }),
    [],
  );

  // The divider is fixed on screen, so in the pictures' own (zoomed, panned) coordinates the cut sits at (screen x - offset) / zoom.
  const cut = view.w > 0 && (view.k !== 1 || view.x !== 0) ? (((pos / 100) * view.w - view.x) / view.k / view.w) * 100 : pos;
  const clip = Math.min(100, Math.max(0, cut));

  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 3;
    if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - step));
    else if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + step));
    else if (e.key === "Home") setPos(0);
    else if (e.key === "End") setPos(100);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const down = (e: PointerEvent) => {
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFrom(e.clientX);
  };

  return (
    <>
      <Zoomable tool={tool} cursor="ew-resize" onView={setView}>
        <div className="absolute inset-0 select-none">
          <img src={after} alt="After" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
          <img src={before} alt="Before" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - clip}% 0 0)` }} />
        </div>
      </Zoomable>
      <div ref={root} className="pointer-events-none absolute inset-0 z-[2]">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Before and after divider. Arrow keys move it."
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={key}
          onPointerDown={down}
          onPointerMove={(e) => drag.current && setFrom(e.clientX)}
          onPointerUp={() => (drag.current = false)}
          onPointerCancel={() => (drag.current = false)}
          // The strip sits above the picture, so hand the wheel to the viewer underneath: zooming works over the divider too.
          onWheel={(e) => root.current?.previousElementSibling?.dispatchEvent(new WheelEvent("wheel", e.nativeEvent))}
          className="group pointer-events-auto absolute inset-y-0 w-11 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
          style={{ left: `${pos}%` }}
        >
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
          <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white font-mono text-[12px] text-black shadow group-focus-visible:ring-2 group-focus-visible:ring-gold">⇆</span>
        </div>
      </div>
      <span className={`${glass} pointer-events-none absolute left-1/2 top-2.5 z-[3] -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-medium`}>Before ◂ ▸ After</span>
    </>
  );
}
