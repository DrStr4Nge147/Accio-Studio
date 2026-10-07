import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Brush, Eraser, Hand, ImagePlus, Redo2, RectangleHorizontal, Trash2, Undo2, X } from "lucide-react";
import { Box } from "../../components/stage/Box";
import { Zoomable, type ZoomTool } from "../../components/stage/Zoomable";
import { boxStroke } from "../../lib/inpaintExport";
import { EmptyPicker, receiveFiles } from "./ImagePicker";
import { MASK_COLOR, boxesOf, renderLines, renderMask, strokeSegment, type Op } from "./maskOps";
import { BOX_RULE } from "./presets";
import { useEdit } from "./store";
import { clearOps, pushOp, redoOp, setInpaintSource, undoOp, useWorkspace, type Source } from "./workspace";

type ToolId = "brush" | "eraser" | "box" | "pan";
const pill = "border border-line bg-raised text-text";
const MIN_BRUSH = 0.5;
const MAX_BRUSH = 25;
const clampBrush = (v: number) => Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, v));

function ToolButton({ label, on, onClick, disabled, children }: { label: string; on?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      data-tip={label}
      disabled={disabled}
      onClick={onClick}
      className={`hover-wash grid h-11 w-11 place-items-center rounded-full transition-colors disabled:opacity-35 ${on ? "bg-gold text-on-gold" : ""}`}
    >
      {children}
    </button>
  );
}

function Editor({ src }: { src: Source }) {
  const ops = useWorkspace((s) => s.inpaint.ops);
  const canRedo = useWorkspace((s) => s.inpaint.redo.length > 0);
  const preset = useEdit((s) => s.inpaint.preset);
  const brush = useEdit((s) => s.inpaint.brush);
  const setInpaint = useEdit((s) => s.setInpaint);
  const [tool, setTool] = useState<ToolId>(preset ? "box" : "brush");
  const [note, setNote] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLCanvasElement>(null);
  const lines = useRef<HTMLCanvasElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const live = useRef({ ops, tool, brush, preset });
  live.current = { ops, tool, brush, preset };

  const stroke = boxStroke(src.w, src.h);
  const rule = preset ? BOX_RULE[preset] : undefined;
  const boxCount = boxesOf(ops).length;

  // The preset decides the tool: boxes for Remove / Move.
  useEffect(() => {
    if (preset) setTool("box");
    else setTool((t) => (t === "box" ? "brush" : t));
  }, [preset]);

  const redraw = (draft?: { x: number; y: number; w: number; h: number }) => {
    const f = fill.current?.getContext("2d");
    const l = lines.current?.getContext("2d");
    if (f) renderMask(f, live.current.ops, src.w, src.h);
    if (l) {
      const boxes = live.current.preset ? boxesOf(live.current.ops) : [];
      renderLines(l, draft ? [...boxes, draft] : boxes, src.w, src.h, stroke);
    }
  };
  useEffect(() => redraw(), [ops, preset, src]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomTool = useMemo<ZoomTool>(() => {
    const cur: {
      stroke: { erase: boolean; size: number; pts: number[]; last: [number, number] } | null;
      box: { x: number; y: number } | null;
      draft: { x: number; y: number; w: number; h: number } | null;
      pending: [number, number][];
      raf: number;
    } = { stroke: null, box: null, draft: null, pending: [], raf: 0 };

    const toImage = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = fill.current!.getBoundingClientRect();
      return [((e.clientX - r.left) * src.w) / r.width, ((e.clientY - r.top) * src.h) / r.height];
    };
    const brushPx = () => Math.max(2, (Math.min(src.w, src.h) * live.current.brush) / 100);
    const moveRing = (e: PointerEvent, show: boolean) => {
      const el = ring.current;
      const box = wrap.current?.getBoundingClientRect();
      const r = fill.current?.getBoundingClientRect();
      const t = live.current.tool;
      if (!el || !box || !r) return;
      if (!show || e.pointerType !== "mouse" || (t !== "brush" && t !== "eraser")) {
        el.style.opacity = "0";
        return;
      }
      const d = (brushPx() * r.width) / src.w;
      el.style.width = el.style.height = `${d}px`;
      el.style.transform = `translate(${e.clientX - box.left - d / 2}px, ${e.clientY - box.top - d / 2}px)`;
      el.style.opacity = "1";
    };
    const flush = () => {
      cur.raf = 0;
      const s = cur.stroke;
      const ctx = fill.current?.getContext("2d");
      if (!s || !ctx) return;
      for (const [x, y] of cur.pending) {
        strokeSegment(ctx, s.size, s.erase, s.last[0], s.last[1], x, y, MASK_COLOR);
        s.pts.push(x, y);
        s.last = [x, y];
      }
      cur.pending = [];
    };
    const abandon = () => {
      cancelAnimationFrame(cur.raf);
      cur.raf = 0;
      Object.assign(cur, { stroke: null, box: null, draft: null, pending: [] });
      redraw();
    };

    return {
      down(e) {
        const [x, y] = toImage(e);
        const t = live.current.tool;
        if (t === "box") {
          cur.box = { x, y };
        } else {
          const size = brushPx();
          cur.stroke = { erase: t === "eraser", size, pts: [x, y], last: [x, y] };
          strokeSegment(fill.current!.getContext("2d")!, size, t === "eraser", x, y, x, y, MASK_COLOR);
        }
        moveRing(e.nativeEvent, true);
      },
      move(e) {
        moveRing(e.nativeEvent, true);
        if (cur.stroke) {
          const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
          for (const ev of evs.length ? evs : [e.nativeEvent]) cur.pending.push(toImage(ev));
          if (!cur.raf) cur.raf = requestAnimationFrame(flush);
        } else if (cur.box) {
          const [x, y] = toImage(e);
          const x0 = Math.max(0, Math.min(cur.box.x, x));
          const y0 = Math.max(0, Math.min(cur.box.y, y));
          cur.draft = { x: x0, y: y0, w: Math.min(src.w, Math.max(cur.box.x, x)) - x0, h: Math.min(src.h, Math.max(cur.box.y, y)) - y0 };
          redraw(cur.draft);
        }
      },
      up(e) {
        moveRing(e.nativeEvent, true);
        if (cur.stroke) {
          cancelAnimationFrame(cur.raf);
          flush();
          const s = cur.stroke;
          cur.stroke = null;
          pushOp({ t: "stroke", erase: s.erase, size: s.size, pts: s.pts });
        } else if (cur.box) {
          const d = cur.draft;
          cur.box = cur.draft = null;
          const min = Math.max(8, Math.min(src.w, src.h) * 0.01);
          if (d && d.w >= min && d.h >= min) {
            const rl = live.current.preset ? BOX_RULE[live.current.preset] : undefined;
            if (rl && boxesOf(live.current.ops).length >= rl.max) {
              setNote(rl.max === 2 ? "Move uses two boxes. Undo one to draw another." : "That is the most boxes you can add.");
              redraw();
            } else {
              setNote(null);
              pushOp({ t: "box", x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h) } as Op);
            }
          } else redraw();
        }
      },
      cancel: abandon,
      hover: (e) => moveRing(e.nativeEvent, true),
      leave: () => {
        if (ring.current) ring.current.style.opacity = "0";
      },
    };
  }, [src, stroke]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop shortcuts: [ ] brush size, Ctrl+Z / Ctrl+Shift+Z undo / redo, B / E / X / H tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.shiftKey ? redoOp() : undoOp();
      } else if (mod && e.key.toLowerCase() === "y") {
        redoOp();
      } else if (!mod && e.key === "[") {
        setInpaint({ brush: clampBrush(+(live.current.brush * 0.85).toFixed(2)) });
      } else if (!mod && e.key === "]") {
        setInpaint({ brush: clampBrush(+(live.current.brush * 1.18).toFixed(2)) });
      } else if (!mod && !e.altKey && "behx".includes(e.key.toLowerCase()) && e.key.length === 1) {
        const k = e.key.toLowerCase();
        setTool(k === "b" ? "brush" : k === "e" ? "eraser" : k === "x" ? "box" : "pan");
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setInpaint]);

  const cursor = tool === "pan" ? undefined : tool === "box" ? "crosshair" : "none";

  // The tools sit in a strip above the canvas, not over it: nothing on screen hides part of the picture.
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-none flex-wrap items-center justify-center gap-2">
        <div className={`${pill} flex items-center gap-0.5 rounded-full p-0.5`} role="toolbar" aria-label="Mask tools">
          <ToolButton label="Brush (B)" on={tool === "brush"} onClick={() => setTool("brush")}>
            <Brush size={20} strokeWidth={1.7} />
          </ToolButton>
          <ToolButton label="Eraser (E)" on={tool === "eraser"} onClick={() => setTool("eraser")}>
            <Eraser size={20} strokeWidth={1.7} />
          </ToolButton>
          <ToolButton label={preset ? "Red box (X)" : "Rectangle (X)"} on={tool === "box"} onClick={() => setTool("box")}>
            <RectangleHorizontal size={20} strokeWidth={1.7} />
          </ToolButton>
          <ToolButton label="Move the view (H, or hold Space)" on={tool === "pan"} onClick={() => setTool("pan")}>
            <Hand size={20} strokeWidth={1.7} />
          </ToolButton>
          <i className="mx-0.5 h-6 w-px bg-line-strong" />
          <ToolButton label="Undo (Ctrl+Z)" disabled={!ops.length} onClick={undoOp}>
            <Undo2 size={20} strokeWidth={1.7} />
          </ToolButton>
          <ToolButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redoOp}>
            <Redo2 size={20} strokeWidth={1.7} />
          </ToolButton>
        </div>
        {(tool === "brush" || tool === "eraser") && (
          <label className={`${pill} flex h-12 w-48 items-center gap-2 rounded-full px-3.5 text-[12px] text-text-2`}>
            <span className="flex-none">Size</span>
            <input
              type="range"
              className="slider min-w-0 flex-1"
              aria-label="Brush size"
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              step={0.5}
              value={brush}
              style={{ ["--pct" as string]: `${((brush - MIN_BRUSH) / (MAX_BRUSH - MIN_BRUSH)) * 100}%` }}
              onChange={(e) => setInpaint({ brush: Number(e.target.value) })}
            />
          </label>
        )}
        <div className={`${pill} flex rounded-full p-0.5`}>
          <ToolButton label="Clear everything" disabled={!ops.length} onClick={clearOps}>
            <Trash2 size={19} strokeWidth={1.7} />
          </ToolButton>
          <ChangeImage />
          <ToolButton label="Close the image and start over" onClick={() => setInpaintSource(null)}>
            <X size={20} strokeWidth={1.7} />
          </ToolButton>
        </div>
      </div>

      {(rule || note) && (
        <p className="flex-none text-center text-[13px] text-text-2" role="status">
          {note ?? rule!.hint}
          {rule && !note && (
            <span className="ml-2 font-mono text-gold-text">
              {boxCount}/{rule.min === rule.max ? rule.max : `${rule.min}+`}
            </span>
          )}
        </p>
      )}

      <div ref={wrap} className="relative min-h-0 flex-1 overflow-hidden rounded-m border border-line bg-raised">
        <Zoomable tool={zoomTool} pan={tool === "pan"} cursor={cursor}>
          <Box w={src.w} h={src.h}>
            <img src={src.url} alt="Image to edit" draggable={false} className="absolute inset-0 h-full w-full select-none" />
            <canvas ref={fill} width={src.w} height={src.h} className="absolute inset-0 h-full w-full opacity-60" aria-hidden />
            <canvas ref={lines} width={src.w} height={src.h} className="absolute inset-0 h-full w-full" aria-hidden />
          </Box>
        </Zoomable>
        <div ref={ring} aria-hidden className="pointer-events-none absolute left-0 top-0 rounded-full border border-white opacity-0 mix-blend-difference" style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }} />
      </div>
    </div>
  );
}

function ChangeImage() {
  return (
    <label className="hover-wash grid h-11 w-11 cursor-pointer place-items-center rounded-full" data-tip="Choose another image" aria-label="Choose another image">
      <ImagePlus size={19} strokeWidth={1.7} />
      <input
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void receiveFiles("inpaint", [...e.target.files]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** Inpaint canvas: the image with a brush, eraser and rectangle tool; the mask is rebuilt from the strokes on demand. */
export function MaskEditor() {
  const src = useWorkspace((s) => s.inpaint.src);
  if (!src) {
    return (
      <EmptyPicker
        mode="inpaint"
        title="Choose the image to change"
        text="Paint over the part you want to replace, describe what should appear there, and Generate. Only the painted area changes."
      />
    );
  }
  return <Editor key={src.url} src={src} />;
}
