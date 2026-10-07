import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Maximize2, Minus, Plus, X } from "lucide-react";

const MAX_K = 10;
const STEP = 1.25;
const glass = "bg-[rgba(10,9,14,0.62)] text-[#f1eadb] border border-white/10 backdrop-blur-md";

/** Optional drawing tool: one pointer on the surface goes to the tool; two fingers, Space + drag, the middle button or `pan` still move the view. */
export interface ZoomTool {
  down: (e: PointerEvent) => void;
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
  /** a second finger landed or the pointer was cancelled: drop the stroke in progress */
  cancel: () => void;
  hover?: (e: PointerEvent) => void;
  leave?: () => void;
}

interface View {
  k: number;
  x: number;
  y: number;
}

/**
 * Zoom and pan for whatever it wraps (an image filling a box). k = 1 is "fit". Wheel / pinch zoom toward the pointer,
 * drag pans, a double click or double tap toggles fit and actual pixels. The transform is written straight to the DOM
 * (GPU), so gestures never re-render the page. Controls sit outside the transformed layer.
 */
export function Zoomable({
  children,
  onExpand,
  onClose,
  tool,
  pan,
  cursor,
}: {
  children: ReactNode;
  onExpand?: () => void;
  onClose?: () => void;
  tool?: ZoomTool;
  /** with a tool: one pointer pans instead of drawing (the hand tool) */
  pan?: boolean;
  cursor?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; v: View; mx: number; my: number } | null>(null);
  // sx/sy/moved describe the press in progress; last* is the previous tap, for double-tap detection.
  const tap = useRef({ sx: 0, sy: 0, moved: false, lastT: 0, lastX: 0, lastY: 0 });
  const [k, setK] = useState(1);
  const gesture = useRef<"tool" | "pan" | null>(null);
  const space = useRef(false);

  const apply = useCallback(() => {
    const { k: kk, x, y } = view.current;
    if (layer.current) layer.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${kk})`;
    setK((prev) => (Math.abs(prev - kk) < 0.005 ? prev : kk));
  }, []);

  /** Keep the image covering the box: at k the layer is k times larger, so x/y may go from (1 - k) * size to 0. */
  const clamp = useCallback((v: View): View => {
    const r = box.current?.getBoundingClientRect();
    const k = Math.min(MAX_K, Math.max(1, v.k));
    if (!r) return { k, x: 0, y: 0 };
    return { k, x: Math.min(0, Math.max(r.width * (1 - k), v.x)), y: Math.min(0, Math.max(r.height * (1 - k), v.y)) };
  }, []);

  /** Zoom to nextK keeping the point (cx, cy), in box coordinates, fixed on screen. */
  const zoomAt = useCallback(
    (nextK: number, cx: number, cy: number) => {
      const v = view.current;
      const k = Math.min(MAX_K, Math.max(1, nextK));
      view.current = clamp({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k });
      apply();
    },
    [apply, clamp],
  );

  const center = () => {
    const r = box.current!.getBoundingClientRect();
    return { cx: r.width / 2, cy: r.height / 2 };
  };
  const reset = useCallback(() => {
    view.current = { k: 1, x: 0, y: 0 };
    apply();
  }, [apply]);

  /** Screen pixels per image pixel at "fit" (the image is letterboxed inside the box with object-fit: contain). */
  const fitScale = () => {
    const img = box.current?.querySelector("img");
    const r = box.current?.getBoundingClientRect();
    return img && r && img.naturalWidth && img.naturalHeight ? Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight) : null;
  };
  /** Zoom level at which one image pixel is one screen pixel; if "fit" is already that big or bigger, plain 2x. */
  const actualK = () => {
    const f = fitScale();
    return f && 1 / f > 1.05 ? 1 / f : 2;
  };
  const toggleActual = (cx: number, cy: number) => (view.current.k > 1.01 ? reset() : zoomAt(actualK(), cx, cy));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(view.current.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Space + drag pans while a tool is active (desktop).
  useEffect(() => {
    if (!tool) return;
    const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    const down = (e: globalThis.KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target)) {
        space.current = true;
        e.preventDefault();
      }
    };
    const up = (e: globalThis.KeyboardEvent) => e.code === "Space" && (space.current = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [tool]);

  // Keep the image inside the box when the box itself changes size (window resize, panes toggling).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      view.current = clamp(view.current);
      apply();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply, clamp]);

  const local = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: PointerEvent) => {
    box.current?.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone (synthetic or released); gestures still work without capture */
    }
    if (e.button === 1) e.preventDefault(); // no autoscroll on middle-button pan
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const { x, y } = local(e);
      Object.assign(tap.current, { sx: x, sy: y, moved: false });
      gesture.current = tool && !pan && !space.current && e.button === 0 ? "tool" : "pan";
      if (gesture.current === "tool") tool!.down(e);
    }
    if (pointers.current.size === 2) {
      if (gesture.current === "tool") tool!.cancel();
      gesture.current = "pan";
      const [a, b] = [...pointers.current.values()];
      const r = box.current!.getBoundingClientRect();
      pinch.current = {
        dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1,
        v: { ...view.current },
        mx: (a!.x + b!.x) / 2 - r.left,
        my: (a!.y + b!.y) / 2 - r.top,
      };
      tap.current.moved = true;
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return tool?.hover?.(e);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.current === "tool" && pointers.current.size === 1) return tool!.move(e);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const r = box.current!.getBoundingClientRect();
      const p = pinch.current;
      const k = Math.min(MAX_K, Math.max(1, (p.v.k * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / p.dist));
      const mx = (a!.x + b!.x) / 2 - r.left;
      const my = (a!.y + b!.y) / 2 - r.top;
      // The point under the fingers' start midpoint follows their current midpoint (zoom + two-finger pan).
      view.current = clamp({ k, x: mx - ((p.mx - p.v.x) * k) / p.v.k, y: my - ((p.my - p.v.y) * k) / p.v.k });
      apply();
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        const p = local(e);
        if (Math.hypot(p.x - tap.current.sx, p.y - tap.current.sy) > 6) tap.current.moved = true;
        if (view.current.k > 1) {
          view.current = clamp({ ...view.current, x: view.current.x + dx, y: view.current.y + dy });
          apply();
        }
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const wasOne = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    if (wasOne && gesture.current === "tool") {
      gesture.current = null;
      return tool!.up(e);
    }
    if (tool || !wasOne || tap.current.moved) return;
    // A tap, not a drag: two quick taps (or a double click) toggle fit / actual pixels.
    const { x, y } = local(e);
    const now = performance.now();
    const tp = tap.current;
    if (now - tp.lastT < 320 && Math.hypot(x - tp.lastX, y - tp.lastY) < 28) {
      toggleActual(x, y);
      tp.lastT = 0;
    } else {
      Object.assign(tp, { lastT: now, lastX: x, lastY: y });
    }
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (gesture.current === "tool") tool!.cancel();
    gesture.current = null;
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const { cx, cy } = center();
    const v = view.current;
    if (e.key === "+" || e.key === "=") zoomAt(v.k * STEP, cx, cy);
    else if (e.key === "-" || e.key === "_") zoomAt(v.k / STEP, cx, cy);
    else if (e.key === "0") reset();
    else if (v.k > 1 && e.key.startsWith("Arrow")) {
      const d = 60;
      view.current = clamp({ ...v, x: v.x + (e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0), y: v.y + (e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0) });
      apply();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const fit = k > 1.005 ? fitScale() : null;
  const label = k <= 1.005 ? "Fit" : fit ? `${Math.round(k * fit * 100)}%` : `${Math.round(k * 100)}%`;

  return (
    <>
      <div
        ref={box}
        tabIndex={0}
        aria-label="Image viewer. Scroll or pinch to zoom, drag to pan, double-click for actual size."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => tool?.leave?.()}
        style={cursor ? { cursor } : undefined}
        className={`absolute inset-0 touch-none select-none overflow-hidden outline-none ${cursor ? "" : tool ? (pan ? "cursor-grab" : "") : k > 1.005 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
      >
        <div ref={layer} className="h-full w-full origin-top-left will-change-transform">
          {children}
        </div>
      </div>

      <div className={`${glass} absolute bottom-2.5 left-2.5 z-[3] flex items-center rounded-full`} role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" data-tip="Zoom out ( - )" disabled={k <= 1.005} onClick={() => { const c = center(); zoomAt(view.current.k / STEP, c.cx, c.cy); }} className="hover-wash grid h-11 w-11 place-items-center rounded-full disabled:opacity-40">
          <Minus size={18} strokeWidth={1.7} />
        </button>
        <button type="button" aria-label="Toggle fit and actual size" data-tip="Fit / actual pixels (double-click)" onClick={() => { const c = center(); toggleActual(c.cx, c.cy); }} className="hover-wash h-11 min-w-12 px-1 text-center font-mono text-[12px]">
          {label}
        </button>
        <button type="button" aria-label="Zoom in" data-tip="Zoom in ( + )" disabled={k >= MAX_K - 0.01} onClick={() => { const c = center(); zoomAt(view.current.k * STEP, c.cx, c.cy); }} className="hover-wash grid h-11 w-11 place-items-center rounded-full disabled:opacity-40">
          <Plus size={18} strokeWidth={1.7} />
        </button>
        {onExpand && (
          <button type="button" aria-label="Open fullscreen" data-tip="Fullscreen" onClick={onExpand} className="hover-wash grid h-11 w-11 place-items-center rounded-full border-l border-white/10">
            <Maximize2 size={17} strokeWidth={1.7} />
          </button>
        )}
      </div>

      {onClose && (
        <button
          type="button"
          aria-label="Close fullscreen"
          data-tip="Close (Esc)"
          onClick={onClose}
          className={`${glass} hover-wash absolute right-3 top-3 z-[3] grid h-11 w-11 place-items-center rounded-full`}
        >
          <X size={20} strokeWidth={1.7} />
        </button>
      )}
    </>
  );
}
