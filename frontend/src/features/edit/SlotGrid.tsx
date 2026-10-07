import { useState, type DragEvent } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Images, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { EmptyPicker, PickButtons, receiveFiles, useFileDrop } from "./ImagePicker";
import { MAX_SLOTS, clearSlots, moveSlot, removeSlot, retrySlot, useWorkspace, type Slot } from "./workspace";

const glassBtn = "grid h-11 w-11 place-items-center rounded-full";
const dot = "grid h-7 w-7 place-items-center rounded-full bg-[rgba(10,9,14,0.72)] text-[#f1eadb]";

function SlotCard({ slot, index, last, dragging, onDragStart, onDragEnd, onDropOn }: { slot: Slot; index: number; last: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onDropOn: (e: DragEvent) => void }) {
  const base = index === 0;
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-accio-slot", String(index));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.dataTransfer.types.includes("text/x-accio-slot") && e.preventDefault()}
      onDrop={onDropOn}
      className={`group relative aspect-square overflow-hidden rounded-m border bg-raised ${base ? "border-gold ring-1 ring-gold/60" : "border-line"} ${dragging ? "opacity-40" : ""}`}
    >
      <img src={slot.url} alt={`Image ${index + 1}: ${slot.name}`} draggable={false} className="h-full w-full object-cover" />
      <span className="absolute left-1.5 top-1.5 flex items-center gap-1">
        <span className={`${dot} font-mono text-[12px] font-semibold ${base ? "!bg-gold !text-on-gold" : ""}`}>{index + 1}</span>
        {base && <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-on-gold">Base</span>}
      </span>
      <button
        type="button"
        aria-label={`Remove image ${index + 1}`}
        data-tip="Remove"
        onClick={() => removeSlot(slot.id)}
        className={`${glassBtn} absolute -right-1.5 -top-1.5 text-[#f1eadb]`}
      >
        <span className={dot}>
          <X size={15} strokeWidth={2} />
        </span>
      </button>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent px-0.5 pb-0.5 pt-6">
        <button type="button" aria-label={base ? "Already first" : `Move image ${index + 1} earlier`} data-tip={index === 1 ? "Make this the base image" : "Move earlier"} disabled={base} onClick={() => moveSlot(index, index - 1)} className={`${glassBtn} text-[#f1eadb] disabled:opacity-30`}>
          <ArrowLeft size={18} strokeWidth={1.8} />
        </button>
        <button type="button" aria-label={last ? "Already last" : `Move image ${index + 1} later`} data-tip="Move later" disabled={last} onClick={() => moveSlot(index, index + 1)} className={`${glassBtn} text-[#f1eadb] disabled:opacity-30`}>
          <ArrowRight size={18} strokeWidth={1.8} />
        </button>
      </div>
      {slot.status === "uploading" && (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-white/20" role="progressbar" aria-label="Uploading" aria-valuenow={Math.round(slot.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-gold transition-[width]" style={{ width: `${Math.max(6, slot.progress * 100)}%` }} />
        </div>
      )}
      {slot.status === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-2 text-center text-[12px] text-[#f1eadb]">
          <div>
            <AlertTriangle size={20} strokeWidth={1.7} className="mx-auto text-danger" />
            <p className="mt-1 line-clamp-3">{slot.error}</p>
            <button type="button" onClick={() => retrySlot(slot.id)} className="mt-1 inline-flex h-11 items-center gap-1 rounded-full px-3 text-gold-hi">
              <RotateCcw size={14} strokeWidth={1.7} /> Try again
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The reference tray: up to 9 numbered images, image 1 is the base that gets edited. */
export function SlotGrid() {
  const slots = useWorkspace((s) => s.slots);
  const [drag, setDrag] = useState<number | null>(null);
  const drop = useFileDrop((f) => void receiveFiles("multiedit", f));
  const uploading = slots.some((s) => s.status === "uploading");

  if (!slots.length) {
    return (
      <EmptyPicker
        mode="multiedit"
        icon={<Images size={22} strokeWidth={1.7} />}
        title="Add the images to edit"
        text="Image 1 is the one that gets changed. Add more (up to 9) as references and mention them in your prompt as <image2>, <image3>…"
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4" {...drop.props}>
      <div className={`mx-auto max-w-3xl rounded-l ${drop.over ? "outline outline-2 outline-offset-4 outline-gold" : ""}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Images</h2>
            <p className="text-[12px] text-text-3">
              {slots.length} of {MAX_SLOTS}. Image 1 is edited; the rest are references (<span className="font-mono">&lt;image2&gt;</span>…). Drag to reorder.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {uploading && (
              <span className="flex items-center gap-1.5 text-[12px] text-text-2">
                <Loader2 size={14} strokeWidth={1.7} className="animate-spin motion-reduce:animate-none" /> Uploading
              </span>
            )}
            <button type="button" onClick={clearSlots} data-tip="Remove all images and start over" className="hover-wash flex h-11 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] text-text-2 hover:text-text">
              <X size={16} strokeWidth={1.7} /> Clear all
            </button>
          </div>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
          {slots.map((s, i) => (
            <SlotCard
              key={s.id}
              slot={s}
              index={i}
              last={i === slots.length - 1}
              dragging={drag === i}
              onDragStart={() => setDrag(i)}
              onDragEnd={() => setDrag(null)}
              onDropOn={(e) => {
                const from = Number(e.dataTransfer.getData("text/x-accio-slot"));
                if (Number.isInteger(from)) {
                  e.preventDefault();
                  moveSlot(from, i);
                }
                setDrag(null);
              }}
            />
          ))}
          {slots.length < MAX_SLOTS && (
            <li className="grid aspect-square place-items-center rounded-m border border-dashed border-line-strong p-2">
              <div className="text-center">
                <Plus size={22} strokeWidth={1.7} className="mx-auto text-text-3" />
                <PickButtons multiple onFiles={(f) => void receiveFiles("multiedit", f)} label="Add" compact />
              </div>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
