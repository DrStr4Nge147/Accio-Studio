import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Copy, Eraser, LayoutTemplate, Plus, Trash2, X } from "lucide-react";
import { Label, Segmented, inputCls } from "../../../components/ui/controls";
import { Sheet } from "../../../components/ui/Sheet";
import { sizeOf, useCreate } from "../store";
import { buildCaption, isEmptyCaption, MAX_ELEMENT_COLORS, parseCaption, regionColor, type Region, type StyleKind } from "./ideogram";
import { useLayout } from "./layoutStore";

const BTN = "hover-wash flex h-11 flex-none items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors disabled:opacity-50";
const AREA = "w-full resize-y rounded-s border border-line bg-raised px-3 py-2 text-[14px] leading-snug text-text outline-none placeholder:text-text-3 focus:border-gold";
const MIN_SIDE = 0.02;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Drag = { kind: "draw" | "move" | "resize"; id: string; px: number; py: number; from: Region };

/** The canvas: drag on empty space to draw a box, drag a box to move it, drag its corner to resize it. */
function Canvas({ aspect }: { aspect: number }) {
  const { regions, selected, setRegions, select } = useLayout();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const at = (e: ReactPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const update = (id: string, p: Partial<Region>) => setRegions(useLayout.getState().regions.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const down = (e: ReactPointerEvent) => {
    const { x, y } = at(e);
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-region]");
    const existing = target && regions.find((r) => r.id === target.dataset.region);
    let next: Drag;
    if (existing) {
      select(existing.id);
      next = { kind: (e.target as HTMLElement).dataset.handle ? "resize" : "move", id: existing.id, px: x, py: y, from: existing };
    } else {
      const fresh: Region = { id: newId(), type: "obj", text: "", desc: "", palette: [], x, y, w: 0, h: 0 };
      setRegions([...regions, fresh]);
      select(fresh.id);
      next = { kind: "draw", id: fresh.id, px: x, py: y, from: fresh };
    }
    drag.current = next;
    ref.current!.setPointerCapture(e.pointerId);
  };

  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = at(e);
    if (d.kind === "draw") update(d.id, { x: Math.min(d.px, x), y: Math.min(d.py, y), w: Math.abs(x - d.px), h: Math.abs(y - d.py) });
    else if (d.kind === "resize") update(d.id, { w: Math.max(MIN_SIDE, x - d.from.x), h: Math.max(MIN_SIDE, y - d.from.y) });
    else update(d.id, { x: clamp(Math.min(d.from.x + x - d.px, 1 - d.from.w)), y: clamp(Math.min(d.from.y + y - d.py, 1 - d.from.h)) });
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== "draw") return;
    const r = useLayout.getState().regions.find((x) => x.id === d.id);
    if (r && (r.w < MIN_SIDE || r.h < MIN_SIDE)) {
      setRegions(useLayout.getState().regions.filter((x) => x.id !== d.id));
      select(null);
    }
  };

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Layout canvas: drag to draw a box"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{ aspectRatio: String(aspect), width: `min(100%, ${(46 * aspect).toFixed(2)}vh)` }}
      className="relative mx-auto cursor-crosshair touch-none select-none overflow-hidden rounded-s border border-line-strong bg-raised"
    >
      {regions.map((r, i) => {
        const c = regionColor(r, i);
        const on = r.id === selected;
        return (
          <div
            key={r.id}
            data-region={r.id}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, borderColor: c, backgroundColor: `${c}${on ? "33" : "14"}` }}
            className={`absolute cursor-move overflow-hidden border-2 ${on ? "z-10" : ""}`}
          >
            <span style={{ backgroundColor: c }} className="pointer-events-none absolute left-0 top-0 px-1 text-[10px] font-semibold leading-4 text-black">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="pointer-events-none absolute inset-x-1 top-4 line-clamp-3 text-[10px] leading-tight text-text-2">{r.type === "text" && r.text ? `"${r.text}"` : r.desc}</span>
            {on && <span data-handle="1" style={{ backgroundColor: c }} className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" />}
          </div>
        );
      })}
    </div>
  );
}

function Palette({ colors, max, onChange, label }: { colors: string[]; max: number; onChange: (c: string[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {colors.map((c, i) => (
        <span key={i} className="relative">
          <input
            type="color"
            value={c}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value : x)))}
            className="h-9 w-9 cursor-pointer rounded-full border border-line-strong bg-transparent p-0.5"
          />
          <button
            type="button"
            aria-label={`Remove ${label} ${i + 1}`}
            onClick={() => onChange(colors.filter((_, j) => j !== i))}
            className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-overlay text-text-2 hover:text-text"
          >
            <X size={10} aria-hidden />
          </button>
        </span>
      ))}
      {colors.length < max && (
        <button type="button" aria-label={`Add ${label}`} onClick={() => onChange([...colors, "#808080"])} className="hover-wash grid h-9 w-9 place-items-center rounded-full border border-dashed border-line-strong text-text-3 hover:text-text">
          <Plus size={15} aria-hidden />
        </button>
      )}
    </div>
  );
}

function RegionEditor({ region }: { region: Region }) {
  const { regions, setRegions, select } = useLayout();
  const patch = (p: Partial<Region>) => setRegions(regions.map((r) => (r.id === region.id ? { ...r, ...p } : r)));
  const remove = () => {
    setRegions(regions.filter((r) => r.id !== region.id));
    select(null);
  };
  const duplicate = () => {
    const copy = { ...region, id: newId(), x: Math.min(region.x + 0.03, 1 - region.w), y: Math.min(region.y + 0.03, 1 - region.h) };
    setRegions([...regions, copy]);
    select(copy.id);
  };
  return (
    <div className="flex flex-col gap-2 rounded-m border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <Segmented<Region["type"]>
          label="Box type"
          small
          value={region.type}
          options={[
            { value: "obj", label: "Object", tip: "Something to draw in this box" },
            { value: "text", label: "Text", tip: "Words to write in this box" },
          ]}
          onChange={(type) => patch({ type })}
        />
        <div className="flex gap-1">
          <button type="button" onClick={duplicate} aria-label="Duplicate box" data-tip="Duplicate this box" className="hover-wash grid h-9 w-9 place-items-center rounded-full border border-line-strong text-text-2 hover:text-text">
            <Copy size={15} aria-hidden />
          </button>
          <button type="button" onClick={remove} aria-label="Delete box" data-tip="Delete this box" className="hover-wash grid h-9 w-9 place-items-center rounded-full border border-line-strong text-text-2 hover:text-text">
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </div>
      {region.type === "text" && <input type="text" value={region.text} onChange={(e) => patch({ text: e.target.value })} placeholder="The exact words to write" aria-label="Text to write" className={inputCls} />}
      <textarea value={region.desc} onChange={(e) => patch({ desc: e.target.value })} placeholder="What is in this box…" aria-label="Box description" rows={3} className={AREA} />
      <div>
        <Label tip="Up to 5 colors for this box. The first one also colors its outline.">Colors</Label>
        <div className="mt-1">
          <Palette colors={region.palette} max={MAX_ELEMENT_COLORS} onChange={(palette) => patch({ palette })} label="Box color" />
        </div>
      </div>
    </div>
  );
}

function TextRow({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; multiline?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} rows={2} className={`mt-1 ${AREA}`} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className={`mt-1 ${inputCls}`} />
      )}
    </div>
  );
}

const STYLES: { value: StyleKind; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "art_style", label: "Art" },
  { value: "none", label: "None" },
];

/** Lays out a MOSS Image with boxes: each box gets its own description, and the result goes in the Create prompt box as Ideogram 4 JSON. */
export function LayoutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scene, regions, selected, setScene, select, clear } = useLayout();
  const size = useCreate(sizeOf);
  const hasPrompt = useCreate((s) => !!s.prompt.trim());
  const caption = useMemo(() => buildCaption(scene, regions), [scene, regions]);
  const empty = isEmptyCaption(scene, regions);
  const current = regions.find((r) => r.id === selected);
  const [sceneOpen, setSceneOpen] = useState(true);

  const apply = () => {
    useCreate.getState().patch({ prompt: caption });
    onClose();
  };

  return createPortal(
    <Sheet
      open={open}
      onClose={onClose}
      title="Layout builder"
      height="92%"
      desktopModalWidth={960}
      footer={
        <div className="flex flex-col gap-2">
          <textarea value={empty ? "" : caption} readOnly rows={3} aria-label="Prompt preview" placeholder="Draw boxes and describe them. The prompt appears here." className={`${AREA} font-mono text-[12px]`} />
          <div className="flex items-center justify-between gap-2 text-[12px] text-text-3">
            <span>{empty ? "" : `${caption.length} characters, sent as the prompt`}</span>
            {hasPrompt && !empty && <span className="flex-none">Replaces your current prompt</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={clear} disabled={empty && !regions.length} data-tip="Remove every box and clear the scene fields" className={`${BTN} border-line-strong text-text-2 hover:text-text`}>
              <Eraser size={17} strokeWidth={1.7} aria-hidden />
              <span className="max-[399px]:hidden">Clear</span>
            </button>
            <button type="button" disabled={empty} onClick={apply} className="h-11 flex-1 rounded-full bg-gold px-5 text-[15px] font-semibold text-on-gold disabled:opacity-50">
              Use this prompt
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-[12.5px] leading-snug text-text-3">
          Drag on the canvas to draw a box and describe what goes in it. Drag a box to move it, its corner to resize it. The canvas matches your current size ({size.w}×{size.h}).
        </p>
        <Canvas aspect={size.w / size.h} />

        {regions.length > 0 && (
          <div role="group" aria-label="Boxes" className="flex flex-wrap gap-1.5">
            {regions.map((r, i) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={r.id === selected}
                onClick={() => select(r.id === selected ? null : r.id)}
                style={{ borderColor: r.id === selected ? regionColor(r, i) : undefined }}
                className="hover-wash h-9 rounded-full border border-line-strong px-3 text-[13px] text-text-2 hover:text-text"
              >
                {String(i + 1).padStart(2, "0")} {r.type === "text" ? "Text" : "Object"}
              </button>
            ))}
          </div>
        )}
        {current && <RegionEditor key={current.id} region={current} />}

        <section aria-label="Import" className="flex flex-col gap-1">
          <Label tip="A layout prompt written elsewhere (the Ideogram 4 JSON). It replaces the boxes and fields above.">Import</Label>
          <textarea
            value=""
            onChange={(e) => {
              const parsed = parseCaption(e.target.value);
              if (parsed) useLayout.setState({ ...parsed, selected: null });
            }}
            placeholder="Paste a layout JSON prompt here to load its boxes"
            aria-label="Paste a layout JSON prompt"
            rows={2}
            className={AREA}
          />
        </section>

        <section aria-label="Scene" className="flex flex-col gap-3">
          <button type="button" aria-expanded={sceneOpen} onClick={() => setSceneOpen(!sceneOpen)} className="flex items-center gap-2 text-left text-[13px] font-semibold text-text">
            <LayoutTemplate size={15} strokeWidth={1.7} aria-hidden />
            Scene and style
          </button>
          {sceneOpen && (
            <>
              <TextRow label="Overview" value={scene.overview} onChange={(overview) => setScene({ overview })} placeholder="One line about the whole image (optional)" />
              <TextRow label="Background" value={scene.background} onChange={(background) => setScene({ background })} placeholder="What is behind everything" multiline />
              <div>
                <Label>Style</Label>
                <div className="mt-1">
                  <Segmented<StyleKind> label="Style" value={scene.style} options={STYLES} onChange={(style) => setScene({ style })} />
                </div>
              </div>
              {scene.style !== "none" && (
                <>
                  <TextRow
                    label={scene.style === "photo" ? "Photo" : "Art style"}
                    value={scene.styleText}
                    onChange={(styleText) => setScene({ styleText })}
                    placeholder={scene.style === "photo" ? "85mm portrait lens, shallow depth of field" : "loose watercolor, soft edges"}
                  />
                  <TextRow label="Aesthetics" value={scene.aesthetics} onChange={(aesthetics) => setScene({ aesthetics })} placeholder="cinematic, elegant, high-fashion" />
                  <TextRow label="Lighting" value={scene.lighting} onChange={(lighting) => setScene({ lighting })} placeholder="soft warm window light from the left" />
                  <TextRow label="Medium" value={scene.medium} onChange={(medium) => setScene({ medium })} placeholder={scene.style === "photo" ? "photograph" : "watercolor on paper"} />
                  <div>
                    <Label tip="The colors that run through the whole image.">Palette</Label>
                    <div className="mt-1">
                      <Palette colors={scene.palette} max={8} onChange={(palette) => setScene({ palette })} label="Scene color" />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </Sheet>,
    document.body,
  );
}

/** Desktop: a small pill inside the prompt box, next to Builder, Style and Templates. */
export function LayoutButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Layout builder"
      data-tip="Draw boxes and describe what goes in each"
      className="hover-wash flex h-8 flex-none items-center gap-1 whitespace-nowrap rounded-full border border-line-strong px-2 text-[12px] text-text-2 transition-colors hover:border-text-3 hover:text-text"
    >
      <LayoutTemplate size={13} strokeWidth={1.7} className="flex-none" aria-hidden />
      <span>Layout</span>
    </button>
  );
}

/** Opens the layout sheet on the boxes in `prompt` when it is a layout prompt (a reused job's, say), else on what was last drawn. */
export function openLayoutFor(prompt: string) {
  const parsed = parseCaption(prompt);
  if (parsed) useLayout.setState({ ...parsed, selected: null });
}
