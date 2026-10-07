import { useRef, type PointerEvent } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import { Box } from "../../components/stage/Box";
import { Zoomable } from "../../components/stage/Zoomable";
import { EmptyPicker, receiveFiles } from "./ImagePicker";
import { useEdit } from "./store";
import { MAX_PAD, clampPad, padsForRatio } from "./pads";
import { NO_PADS, setPads, useWorkspace, type Pads } from "./workspace";

const glass = "bg-[rgba(10,9,14,0.62)] text-[#f1eadb] border border-white/10 backdrop-blur-md";
type Side = keyof Pads;

const RATIOS: { label: string; w: number; h: number }[] = [
  { label: "1:1", w: 1, h: 1 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:4", w: 3, h: 4 },
  { label: "16:9", w: 16, h: 9 },
  { label: "9:16", w: 9, h: 16 },
];

function Handle({ side, vertical, pos, span, onStart, onMove, value }: { side: Side; vertical: boolean; pos: string; span: [string, string]; onStart: (e: PointerEvent) => void; onMove: (e: PointerEvent) => void; value: number }) {
  const names = { l: "left", r: "right", t: "top", b: "bottom" } as const;
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`Extend ${names[side]} edge`}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={MAX_PAD}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && onMove(e)}
      onKeyDown={(e) => {
        // The arrow pointing away from the image grows the pad by 8 px, the opposite one shrinks it.
        const outward = { l: "ArrowLeft", r: "ArrowRight", t: "ArrowUp", b: "ArrowDown" }[side];
        const inward = { l: "ArrowRight", r: "ArrowLeft", t: "ArrowDown", b: "ArrowUp" }[side];
        const delta = e.key === outward ? 8 : e.key === inward ? -8 : 0;
        if (!delta) return;
        e.preventDefault();
        const cur = useWorkspace.getState().outpaint.pads;
        setPads({ ...cur, [side]: clampPad(cur[side] + delta) });
      }}
      className={`absolute z-[2] touch-none outline-none ${vertical ? "w-11 -translate-x-1/2 cursor-ew-resize" : "h-11 -translate-y-1/2 cursor-ns-resize"} group`}
      style={vertical ? { left: pos, top: span[0], height: span[1] } : { top: pos, left: span[0], width: span[1] }}
    >
      <span className={`absolute rounded-full bg-gold shadow-[0_0_0_1px_rgba(0,0,0,0.4)] group-focus-visible:ring-2 group-focus-visible:ring-white ${vertical ? "left-1/2 top-0 h-full w-[3px] -translate-x-1/2" : "left-0 top-1/2 h-[3px] w-full -translate-y-1/2"}`} />
      <span className={`absolute grid place-items-center rounded-full bg-gold text-on-gold shadow ${vertical ? "left-1/2 top-1/2 h-10 w-[18px] -translate-x-1/2 -translate-y-1/2" : "left-1/2 top-1/2 h-[18px] w-10 -translate-x-1/2 -translate-y-1/2"}`}>
        <i className={`rounded-full bg-on-gold/70 ${vertical ? "h-5 w-[2px]" : "h-[2px] w-5"}`} />
      </span>
    </div>
  );
}

function Editor({ src }: { src: NonNullable<ReturnType<typeof useWorkspace.getState>["outpaint"]["src"]> }) {
  const pads = useWorkspace((s) => s.outpaint.pads);
  const fillMode = useEdit((s) => s.outpaint.fillMode);
  const fillColor = useEdit((s) => s.outpaint.fillColor);
  const upload = useWorkspace((s) => s.outpaint.upload);
  const drag = useRef<{ side: Side; start: number; origin: number; scale: number } | null>(null);
  const content = useRef<HTMLDivElement>(null);

  // The view always has room to grow by 60% of the longer side; typing more widens it.
  const room = Math.round(Math.max(src.w, src.h) * 0.6);
  const ext: Pads = { l: Math.max(room, pads.l), r: Math.max(room, pads.r), t: Math.max(room, pads.t), b: Math.max(room, pads.b) };
  const EW = src.w + ext.l + ext.r;
  const EH = src.h + ext.t + ext.b;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  const start = (side: Side) => (e: PointerEvent) => {
    const r = content.current!.getBoundingClientRect();
    const horizontal = side === "l" || side === "r";
    drag.current = { side, start: horizontal ? e.clientX : e.clientY, origin: useWorkspace.getState().outpaint.pads[side], scale: horizontal ? r.width / EW : r.height / EH };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const horizontal = d.side === "l" || d.side === "r";
    const delta = ((horizontal ? e.clientX : e.clientY) - d.start) / d.scale;
    const grow = d.side === "l" || d.side === "t" ? -delta : delta; // dragging outward adds padding
    const cur = useWorkspace.getState().outpaint.pads;
    setPads({ ...cur, [d.side]: clampPad(d.origin + grow) });
  };

  const padBox = { left: pct(ext.l - pads.l, EW), top: pct(ext.t - pads.t, EH), width: pct(src.w + pads.l + pads.r, EW), height: pct(src.h + pads.t + pads.b, EH) };
  const solid = fillMode === "color";
  const tag = (v: number, style: React.CSSProperties) =>
    v > 0 && (
      <span className={`${glass} pointer-events-none absolute z-[1] rounded-full px-2 py-0.5 font-mono text-[11px]`} style={style}>
        +{v}
      </span>
    );

  return (
    <div className="relative h-full overflow-hidden rounded-m border border-line bg-raised">
      <Zoomable>
        <Box w={EW} h={EH}>
          <div ref={content} className="absolute inset-0 select-none" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent 0 8px, color-mix(in srgb, var(--text) 5%, transparent) 8px 16px)" }}>
            <div className="absolute" style={{ ...padBox, background: solid ? fillColor : "#6e6e6e" }}>
              {!solid && <div className="absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 6px, transparent 6px 12px)" }} />}
            </div>
            <img src={src.url} alt="Image to extend" draggable={false} className="absolute" style={{ left: pct(ext.l, EW), top: pct(ext.t, EH), width: pct(src.w, EW), height: pct(src.h, EH) }} />
            {tag(pads.l, { left: pct(ext.l - pads.l / 2, EW), top: pct(ext.t + src.h / 2, EH), transform: "translate(-50%, -50%)" })}
            {tag(pads.r, { left: pct(ext.l + src.w + pads.r / 2, EW), top: pct(ext.t + src.h / 2, EH), transform: "translate(-50%, -50%)" })}
            {tag(pads.t, { left: pct(ext.l + src.w / 2, EW), top: pct(ext.t - pads.t / 2, EH), transform: "translate(-50%, -50%)" })}
            {tag(pads.b, { left: pct(ext.l + src.w / 2, EW), top: pct(ext.t + src.h + pads.b / 2, EH), transform: "translate(-50%, -50%)" })}
            <Handle side="l" vertical pos={pct(ext.l - pads.l, EW)} span={[pct(ext.t, EH), pct(src.h, EH)]} onStart={start("l")} onMove={move} value={pads.l} />
            <Handle side="r" vertical pos={pct(ext.l + src.w + pads.r, EW)} span={[pct(ext.t, EH), pct(src.h, EH)]} onStart={start("r")} onMove={move} value={pads.r} />
            <Handle side="t" vertical={false} pos={pct(ext.t - pads.t, EH)} span={[pct(ext.l, EW), pct(src.w, EW)]} onStart={start("t")} onMove={move} value={pads.t} />
            <Handle side="b" vertical={false} pos={pct(ext.t + src.h + pads.b, EH)} span={[pct(ext.l, EW), pct(src.w, EW)]} onStart={start("b")} onMove={move} value={pads.b} />
          </div>
        </Box>
      </Zoomable>

      <div className="pointer-events-none absolute inset-x-0 top-2.5 z-[3] flex flex-col items-center gap-2 px-2">
        <div className={`${glass} pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-0.5 no-scrollbar`} role="toolbar" aria-label="Expand to a ratio">
          {RATIOS.map((r) => (
            <button key={r.label} type="button" data-tip={`Grow the canvas to ${r.label}`} onClick={() => setPads(padsForRatio(src.w, src.h, r.w, r.h))} className="hover-wash h-11 flex-none rounded-full px-3 font-mono text-[12px]">
              {r.label}
            </button>
          ))}
          <i className="mx-0.5 h-6 w-px flex-none bg-white/15" />
          <button type="button" aria-label="Reset padding" data-tip="Reset padding" disabled={!pads.l && !pads.t && !pads.r && !pads.b} onClick={() => setPads(NO_PADS)} className="hover-wash grid h-11 w-11 flex-none place-items-center rounded-full disabled:opacity-35">
            <RotateCcw size={18} strokeWidth={1.7} />
          </button>
          <label className="hover-wash grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full" data-tip="Choose another image" aria-label="Choose another image">
            <ImagePlus size={19} strokeWidth={1.7} />
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void receiveFiles("outpaint", [...e.target.files]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {upload.status !== "ready" && (
        <div className={`${glass} pointer-events-none absolute bottom-14 left-1/2 z-[3] -translate-x-1/2 rounded-full px-4 py-2 text-[13px]`} role="status">
          {upload.status === "error" ? upload.error : `Uploading… ${Math.round(upload.progress * 100)}%`}
        </div>
      )}
    </div>
  );
}

/** Outpaint canvas: drag the gold edges outward to add padding; the padded area is what gets generated. */
export function OutpaintEditor() {
  const src = useWorkspace((s) => s.outpaint.src);
  if (!src) {
    return (
      <EmptyPicker
        mode="outpaint"
        title="Choose the image to extend"
        text="Drag the edges outward to add room, then Generate. The model continues the scene into the new area and leaves your picture as it is."
      />
    );
  }
  return <Editor key={src.url} src={src} />;
}
