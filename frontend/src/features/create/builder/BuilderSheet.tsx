import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Dices, Eraser, WandSparkles } from "lucide-react";
import { Label, Segmented } from "../../../components/ui/controls";
import { Sheet } from "../../../components/ui/Sheet";
import { useCreate } from "../store";
import { buildPrompt, CUSTOM_PREFIX, isEmpty, LONG_PROMPT_WORDS, randomSelection, wordCount } from "./buildPrompt";
import { CUSTOM, FIELDS, MODE_LABELS, type BuilderField, type BuilderMode } from "./options";
import { useBuilder } from "./store";

const MODES = (Object.keys(MODE_LABELS) as BuilderMode[]).map((value) => ({ value, label: MODE_LABELS[value].label }));
const BTN = "hover-wash flex h-11 flex-none items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors disabled:opacity-50";

/** One field: its label, a wrapping row of option pills (tapping the chosen one again clears it) and a box to type your own. */
function FieldRow({ mode, field, value, onPick }: { mode: BuilderMode; field: BuilderField; value: string | undefined; onPick: (id: string | undefined) => void }) {
  const spec = CUSTOM[mode][field.id];
  const typed = value?.startsWith(CUSTOM_PREFIX) ? value.slice(CUSTOM_PREFIX.length) : "";
  return (
    <div role="group" aria-label={field.label}>
      <Label>{field.label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {field.options.map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? undefined : o.id)}
              className={`hover-wash h-9 rounded-full border px-3 text-[13px] transition-colors ${
                on ? "border-gold/55 bg-gold-wash text-gold-text" : "border-line-strong text-text-2 hover:border-text-3 hover:text-text"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {spec && (
        <input
          type="text"
          value={typed}
          onChange={(e) => onPick(e.target.value.trim() ? CUSTOM_PREFIX + e.target.value : undefined)}
          placeholder={spec.example}
          aria-label={`${field.label}: type your own`}
          maxLength={120}
          data-tip="Or type your own. The words that connect it to the sentence (wearing, with…) are added for you."
          className={`mt-1.5 h-9 w-full rounded-full border bg-raised px-3 text-[13px] text-text outline-none placeholder:text-text-3 focus:border-gold sm:max-w-sm ${
            typed ? "border-gold/55" : "border-line"
          }`}
        />
      )}
      {spec && typed.trim() && spec.reject?.(typed.trim()) && (
        <p role="alert" className="mt-1 text-[12px] text-danger">
          {spec.rejectNote}
        </p>
      )}
    </div>
  );
}

/** Builds a prompt from chosen options (Character or Scene) plus free details, and puts it in the Create prompt box. */
export function BuilderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mode, selections, extra, setMode, setSelection, setExtra } = useBuilder();
  const hasPrompt = useCreate((s) => !!s.prompt.trim());
  const sel = selections[mode];
  const built = useMemo(() => buildPrompt(mode, sel, extra[mode]), [mode, sel, extra]);
  const empty = isEmpty(sel, extra[mode], mode);

  // The preview is editable before applying; choosing something else rebuilds it.
  const [edited, setEdited] = useState<string | null>(null);
  useEffect(() => setEdited(null), [built, open]);
  const text = edited ?? built;
  const words = wordCount(text);

  const groups = useMemo(() => {
    const out: { name: string; fields: BuilderField[] }[] = [];
    for (const f of FIELDS[mode]) {
      const g = out.find((x) => x.name === f.group);
      if (g) g.fields.push(f);
      else out.push({ name: f.group, fields: [f] });
    }
    return out;
  }, [mode]);

  const apply = () => {
    useCreate.getState().patch({ prompt: text });
    onClose();
  };

  // Portaled to <body> like the other Create sheets (the composer dock is its own stacking context).
  return createPortal(
    <Sheet
      open={open}
      onClose={onClose}
      title="Prompt builder"
      height="92%"
      desktopModalWidth={960}
      footer={
        <div className="flex flex-col gap-2">
          <textarea
            value={empty ? "" : text}
            onChange={(e) => setEdited(e.target.value)}
            placeholder="Pick options above and the prompt appears here. You can edit it before using it."
            aria-label="Prompt preview"
            rows={3}
            className="w-full resize-y rounded-s border border-line bg-raised px-3 py-2 text-[13.5px] leading-snug text-text outline-none placeholder:text-text-3 focus:border-gold"
          />
          <div className="flex items-center justify-between gap-2 text-[12px] text-text-3">
            <span className={words > LONG_PROMPT_WORDS ? "text-gold-text" : undefined}>
              {empty ? "" : `${words} words${words > LONG_PROMPT_WORDS ? ": long prompts can contradict themselves, so consider dropping a few options" : ""}`}
            </span>
            {hasPrompt && !empty && <span className="flex-none">Replaces your current prompt</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelection(mode, randomSelection(mode))} data-tip="Fill the options at random for a quick idea" className={`${BTN} border-line-strong text-text-2 hover:text-text`}>
              <Dices size={17} strokeWidth={1.7} aria-hidden />
              <span className="max-[399px]:hidden">Randomize</span>
            </button>
            <button
              type="button"
              disabled={empty && !extra[mode]}
              onClick={() => {
                setSelection(mode, {});
                setExtra(mode, "");
              }}
              data-tip="Clear every option and the extra details for this mode"
              className={`${BTN} border-line-strong text-text-2 hover:text-text`}
            >
              <Eraser size={17} strokeWidth={1.7} aria-hidden />
              <span className="max-[399px]:hidden">Clear</span>
            </button>
            <button type="button" disabled={!text.trim()} onClick={apply} className="h-11 flex-1 rounded-full bg-gold px-5 text-[15px] font-semibold text-on-gold disabled:opacity-50">
              Use this prompt
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <Segmented<BuilderMode> label="Prompt type" value={mode} options={MODES} onChange={setMode} />
          <p className="mt-2 text-[12.5px] leading-snug text-text-3">{MODE_LABELS[mode].hint} Every option is optional: tap one again to clear it.</p>
        </div>
        {groups.map((g) => (
          <section key={g.name} aria-label={g.name} className="flex flex-col gap-3">
            <h3 className="text-[13px] font-semibold text-text">{g.name}</h3>
            {g.fields.map((f) => (
              <FieldRow
                key={f.id}
                mode={mode}
                field={f}
                value={sel[f.id]}
                onPick={(id) => {
                  const next = { ...sel };
                  if (id) next[f.id] = id;
                  else delete next[f.id];
                  setSelection(mode, next);
                }}
              />
            ))}
          </section>
        ))}
        <section aria-label="Additional details" className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-text">Additional details</h3>
          <textarea
            value={extra[mode]}
            onChange={(e) => setExtra(mode, e.target.value)}
            placeholder={mode === "character" ? "Anything else: a scar, glasses, a red umbrella, a tattoo…" : "Anything else: a small boat on the water, birds in the sky…"}
            aria-label="Additional details"
            rows={3}
            maxLength={600}
            className="w-full resize-y rounded-s border border-line bg-raised px-3 py-2 text-[14px] leading-snug text-text outline-none placeholder:text-text-3 focus:border-gold"
          />
        </section>
      </div>
    </Sheet>,
    document.body,
  );
}

const useSheet = () => {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
};

/** Desktop: a small pill inside the prompt box, next to Style and Templates. */
export function BuilderButton() {
  const sheet = useSheet();
  return (
    <>
      <button
        type="button"
        onClick={sheet.show}
        aria-label="Prompt builder"
        data-tip="Build a prompt from options: character or scene"
        className="hover-wash flex h-8 flex-none items-center gap-1 whitespace-nowrap rounded-full border border-line-strong px-2 text-[12px] text-text-2 transition-colors hover:border-text-3 hover:text-text"
      >
        <WandSparkles size={13} strokeWidth={1.7} className="flex-none" aria-hidden />
        <span>Builder</span>
      </button>
      <BuilderSheet open={sheet.open} onClose={sheet.close} />
    </>
  );
}
