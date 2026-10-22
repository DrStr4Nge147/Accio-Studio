import { Loader2, TriangleAlert, UserRound } from "lucide-react";
import { LoadNote } from "../../components/LoadNote";
import { Chip, Field, Label, Segmented, inputCls } from "../../components/ui/controls";
import { EmptyPicker, PickButtons, receiveFiles } from "./ImagePicker";
import { BASE_SIZES, BODY_VIEWS, FACE_VIEWS, MAX_SIZE, MIN_SIZE, SCALES, renderCount, sheetSizes, toggleView, type GroupSizes, type SheetDelivery, type SheetView, type Size, type SizeMode } from "./sheet";
import { useEdit } from "./store";
import { useWorkspace } from "./workspace";

const DELIVERY: { value: SheetDelivery; label: string; tip: string }[] = [
  { value: "separate", label: "One by one", tip: "Each angle is rendered on its own at full quality, then stitched into one faces sheet and one body sheet. Slower." },
  { value: "merged", label: "Merged", tip: "The model draws a whole sheet in one picture, twice (faces, body). Much quicker, but each view is smaller and less detailed." },
];

function ViewPicker({ title, views, chosen, onChange }: { title: string; views: SheetView[]; chosen: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <Label>{title}</Label>
      <div className="mt-1 flex flex-wrap gap-x-1.5">
        {views.map((v) => (
          <Chip key={v.key} on={chosen.includes(v.key)} onClick={() => onChange(toggleView(chosen, v.key, views))}>
            {v.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

const MP = 1_000_000;
const mpOf = ([w, h]: Size) => (w * h) / MP;

function SizeInputs({ label, value, onChange }: { label: string; value: Size; onChange: (v: Size) => void }) {
  const num = (i: 0 | 1) => (e: React.ChangeEvent<HTMLInputElement>) => onChange(i === 0 ? [Number(e.target.value), value[1]] : [value[0], Number(e.target.value)]);
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Field label="Width">
          <input type="number" inputMode="numeric" step={8} min={MIN_SIZE} max={MAX_SIZE} value={value[0]} onChange={num(0)} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Height">
          <input type="number" inputMode="numeric" step={8} min={MIN_SIZE} max={MAX_SIZE} value={value[1]} onChange={num(1)} className={`${inputCls} font-mono`} />
        </Field>
      </div>
      <LoadNote mp={mpOf(value)} what={`${label}`} />
    </div>
  );
}

/** Resolution: a multiple of the size the model is tuned for (auto), or exact sizes typed in (manual). */
function Resolution() {
  const sheet = useEdit((s) => s.sheet);
  const setSheet = useEdit((s) => s.setSheet);
  const merged = sheet.delivery === "merged";
  const sizes = sheetSizes(sheet);
  const showFace = sheet.faceViews.length > 0;
  const showBody = sheet.bodyViews.length > 0;
  const [faceName, bodyName] = merged ? ["Face sheet", "Body sheet"] : ["Each face view", "Each body view"];
  const setManual = (part: Partial<GroupSizes>) => setSheet({ manual: { ...sheet.manual, [sheet.delivery]: { ...sheet.manual[sheet.delivery], ...part } } });
  const fmt = ([w, h]: Size) => `${w} × ${h}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Resolution</Label>
        <Segmented<SizeMode>
          small
          label="Resolution mode"
          value={sheet.sizeMode}
          onChange={(sizeMode) => setSheet({ sizeMode, ...(sizeMode === "manual" ? { manual: { ...sheet.manual, [sheet.delivery]: sizes } } : {}) })}
          options={[
            { value: "auto", label: "Auto", tip: "A multiple of the size the model is tuned for" },
            { value: "manual", label: "Manual", tip: "Type the width and height yourself" },
          ]}
        />
      </div>
      {sheet.sizeMode === "auto" ? (
        <>
          <Segmented<number> label="Resolution scale" value={sheet.scale} onChange={(scale) => setSheet({ scale })} options={SCALES.map((k) => ({ value: k, label: `${k}×`, tip: k === 1 ? "The size the model is tuned for" : `${k} times the tuned size on each side` }))} />
          <p className="text-[12px] leading-snug text-text-3">
            {[showFace && `${faceName} ${fmt(sizes.face)}`, showBody && `${bodyName} ${fmt(sizes.body)}`].filter(Boolean).join(" · ")}.{" "}
            {sheet.scale === 1 ? "1× is what the model is tuned for." : "Higher is sharper but slower and needs more memory; very high values may run out of memory."}
          </p>
          {showFace && <LoadNote mp={mpOf(sizes.face)} what={faceName} />}
          {showBody && <LoadNote mp={mpOf(sizes.body)} what={bodyName} />}
        </>
      ) : (
        <div className="space-y-3">
          {showFace && <SizeInputs label={faceName} value={sheet.manual[sheet.delivery].face} onChange={(face) => setManual({ face })} />}
          {showBody && <SizeInputs label={bodyName} value={sheet.manual[sheet.delivery].body} onChange={(body) => setManual({ body })} />}
          <button
            type="button"
            onClick={() => setManual(BASE_SIZES[sheet.delivery])}
            className="hover-wash h-9 rounded-full px-2 text-[12px] text-gold-text"
          >
            Reset to the tuned sizes
          </button>
          <p className="text-[12px] leading-snug text-text-3">Multiples of 8, from {MIN_SIZE} to {MAX_SIZE}. Portrait for body views and square for faces work best.</p>
        </div>
      )}
    </div>
  );
}

/** Character sheet canvas: the photo, how to render (one by one / merged) and which views to include. */
export function SheetEditor() {
  const src = useWorkspace((s) => s.sheet.src);
  const upload = useWorkspace((s) => s.sheet.upload);
  const sheet = useEdit((s) => s.sheet);
  const setSheet = useEdit((s) => s.setSheet);

  if (!src) {
    return (
      <EmptyPicker
        mode="charsheet"
        title="Make a character sheet"
        text="Choose one clear photo of the character. You get a sheet of face close-ups from several angles and a sheet of full-body views."
        icon={<UserRound size={22} strokeWidth={1.7} />}
      />
    );
  }

  const n = renderCount(sheet);
  return (
    <div className="h-full overflow-y-auto p-1 sm:p-4">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-start gap-3">
          <div className="relative h-28 w-28 flex-none overflow-hidden rounded-m border border-line bg-raised">
            <img src={src.url} alt={`Character photo: ${src.name}`} draggable={false} className="h-full w-full object-cover" />
            {upload.status === "uploading" && (
              <div className="absolute inset-x-0 top-0 h-[3px] bg-white/20" role="progressbar" aria-label="Uploading" aria-valuenow={Math.round(upload.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-gold transition-[width]" style={{ width: `${Math.max(6, upload.progress * 100)}%` }} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] text-text">{src.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-text-3">
              {upload.status === "uploading" && <Loader2 size={13} strokeWidth={1.7} className="animate-spin motion-reduce:animate-none" />}
              {upload.status === "uploading" ? "Uploading…" : upload.status === "error" ? (upload.error ?? "Upload failed") : `${src.w} × ${src.h}`}
            </p>
            <div className="mt-2">
              <PickButtons mode="charsheet" compact label="Change photo" onFiles={(f) => void receiveFiles("charsheet", f)} />
            </div>
          </div>
        </div>

        <div>
          <Label>Rendering</Label>
          <div className="mt-1">
            <Segmented<SheetDelivery> label="How to render the sheet" value={sheet.delivery} onChange={(delivery) => setSheet({ delivery })} options={DELIVERY} />
          </div>
          <p className="mt-1.5 text-[12px] leading-snug text-text-3">{DELIVERY.find((d) => d.value === sheet.delivery)?.tip}</p>
        </div>

        <ViewPicker title="Face close-ups" views={FACE_VIEWS} chosen={sheet.faceViews} onChange={(faceViews) => setSheet({ faceViews })} />
        <ViewPicker title="Full body" views={BODY_VIEWS} chosen={sheet.bodyViews} onChange={(bodyViews) => setSheet({ bodyViews })} />

        <Resolution />

        <div className="rounded-m border border-line bg-raised px-3 py-2.5 text-[13px] text-text-2">
          {n === 0 ? (
            "Choose at least one view."
          ) : (
            <>
              This makes <b className="font-semibold text-text">{n}</b> {n === 1 ? "render" : "renders"}, each taking about as long as one Multi-edit.
              {sheet.delivery === "separate" && n > 1 && " On a slower graphics card that can be a long wait; you can leave this page and come back."}
            </>
          )}
        </div>
        {sheet.delivery === "merged" && n > 0 && (
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-text-3">
            <TriangleAlert size={14} strokeWidth={1.7} className="mt-px flex-none" />
            Merged sheets are faster but lower quality: every view is drawn small, and the model may not keep all angles exact. Use One by one for the best result.
            {sheet.faceViews.length === 5 && " With 5 face views the model draws a full grid of 6, so the back of the head is added."}
          </p>
        )}
      </div>
    </div>
  );
}
