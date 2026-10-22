import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Palette, Search, SlidersHorizontal, X } from "lucide-react";
import { Chip, Toggle } from "../../components/ui/controls";
import { Sheet } from "../../components/ui/Sheet";
import { isKleinModel } from "../edit/klein";
import { useEdit } from "../edit/store";
import { useCreate } from "./store";
import { loadStyles, stylePreviewUrl, styleText, type StyleDef, type StyleOpts } from "./styles";

/** Which composer the picker works for: Create adds the style to its prompt, Edit sends it as a restyle instruction. */
export type StyleTarget = "create" | "edit";

function useStyleTarget(target: StyleTarget) {
  const createStyle = useCreate((s) => s.style);
  const createOpts = useCreate((s) => s.styleOpts);
  const editStyle = useEdit((s) => s.style);
  const editOpts = useEdit((s) => s.styleOpts);
  const edit = target === "edit";
  return {
    style: edit ? editStyle : createStyle,
    opts: edit ? editOpts : createOpts,
    setStyle: (style: { id: string; name: string } | null) => {
      if (!edit) return useCreate.getState().patch({ style });
      const ed = useEdit.getState();
      // Picking a style turns Edit's Prompt enhancer off so the instruction goes out as written; clearing the style turns it
      // back on. Either way it stays a normal switch the user can flip.
      ed.patch({ style, enhancer: { ...ed.enhancer, multiedit: !style } });
    },
    setOpts: (styleOpts: StyleOpts) => (edit ? useEdit.getState().patch({ styleOpts }) : useCreate.getState().patch({ styleOpts })),
  };
}

const ALL = "All";
/** Tagged on most drawn or painted styles, so as a filter it only duplicates the specific categories. */
const HIDDEN_CATEGORIES = new Set(["Illustration"]);

/** The sheet that lists the style library; picking a row sets the style and closes it. */
function StyleSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: StyleTarget }) {
  const { style, opts, setStyle, setOpts } = useStyleTarget(target);
  const edit = target === "edit";
  // Edit's Prompt enhancer would rewrite the template (Klein has none)
  const enhancerOn = useEdit((s) => s.enhancer.multiedit && !isKleinModel(s.model));
  const [styles, setStyles] = useState<StyleDef[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);

  const list = useRef<HTMLUListElement>(null);

  // Each time the sheet opens: clear any leftover filter, then bring the current pick into view. The scroll waits until
  // the unfiltered list is actually on screen (scrolling earlier lands short once the list grows) and repeats after the
  // open animation, when the final layout settles.
  const scrollPending = useRef(false);
  useEffect(() => {
    if (!open || !styles) return;
    scrollPending.current = true;
    setQuery("");
    setCategory(ALL);
  }, [open, styles]);

  useEffect(() => {
    if (!open || !styles || !scrollPending.current || query !== "" || category !== ALL) return;
    scrollPending.current = false;
    const toPick = () => list.current?.querySelector('[data-picked="true"]')?.scrollIntoView({ block: "center" });
    const frame = requestAnimationFrame(toPick);
    const later = window.setTimeout(toPick, 250);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
    };
  }, [open, styles, query, category]);

  useEffect(() => {
    if (!open || styles) return;
    setFailed(false);
    loadStyles().then(setStyles, () => setFailed(true));
  }, [open, styles]);

  const categories = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of styles ?? []) for (const c of s.categories) if (!HIDDEN_CATEGORIES.has(c)) count.set(c, (count.get(c) ?? 0) + 1);
    const named = [...count].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
    return [{ name: ALL, n: styles?.length ?? 0 }, ...named];
  }, [styles]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (styles ?? []).filter(
      (s) => (category === ALL || s.categories.includes(category)) && (!q || s.name.toLowerCase().includes(q) || s.compact.toLowerCase().includes(q)),
    );
  }, [styles, query, category]);

  // Tapping the selected style again takes it off; there is no separate "no style" card.
  const pick = (next: StyleDef) => {
    setStyle(next.id === style?.id ? null : { id: next.id, name: next.name });
    onClose();
  };

  // Portaled to <body>: inside the composer dock (its own stacking context, clipped chip row) the sheet rendered half-hidden on phones.
  return createPortal(
    <Sheet open={open} onClose={onClose} title="Style" height="88%" desktopModalWidth={1120}>
      {/* search, category and the two switches (below lg: an options popover) stay put while the long list scrolls under them */}
      <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 pb-1 pt-1 lg:-top-5 lg:-mx-6 lg:px-6 lg:pt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search size={16} strokeWidth={1.7} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search styles…"
            aria-label="Search styles"
            className="h-11 w-full rounded-m border border-line-strong bg-raised pl-9 pr-3 text-[15px] text-text outline-none placeholder:text-text-3 focus:border-gold"
          />
        </div>
        <div className="flex items-center gap-2 sm:flex-none">
        <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category"
            className={`h-11 w-full cursor-pointer appearance-none rounded-m border bg-raised pl-3 pr-9 text-[15px] outline-none focus:border-gold ${
              category === ALL ? "border-line-strong text-text-2" : "border-gold/55 text-gold-text"
            }`}
          >
            {categories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name === ALL ? `All categories (${c.n})` : `${c.name} (${c.n})`}
              </option>
            ))}
          </select>
          <ChevronDown size={16} strokeWidth={1.7} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden />
        </div>
        <div className="lg:hidden">
          <OptionsButton target={target} />
        </div>
        </div>
        <div className="hidden flex-none items-center gap-5 lg:flex">
          <MiniToggle on={opts.first} onChange={(first) => setOpts({ ...opts, first })} label="Style first" tip={edit ? "Put the style instruction before your request instead of after it" : "Put the style before your prompt instead of after it"} />
        </div>
      </div>
      </div>
      {edit && enhancerOn && (
        <p role="note" className="mt-2 rounded-s border border-line px-3 py-2 text-[12.5px] leading-snug text-text-2">
          Picking a style turns the Prompt enhancer off so the style instruction is sent as written; removing the style turns it back on. You can flip it yourself in the controls.
        </p>
      )}
      <ul ref={list} className="mt-2 grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
        {styles === null && <li className="col-span-full py-6 text-center text-[13px] text-text-3">{failed ? "Couldn't load the styles." : "Loading styles…"}</li>}
        {styles && shown.length === 0 && <li className="col-span-full py-6 text-center text-[13px] text-text-3">No styles match.</li>}
        {shown.map((s) => (
          <li key={s.id}>
            <Row active={style?.id === s.id} title={s.name} text={edit ? s.compact : styleText(s)} thumb={s.preview ? stylePreviewUrl(s.id, edit) : undefined} onClick={() => pick(s)} />
          </li>
        ))}
      </ul>
    </Sheet>,
    document.body,
  );
}

/** Below lg: one button beside the category dropdown that opens the two switches in a small popover. */
function OptionsButton({ target }: { target: StyleTarget }) {
  const { opts, setOpts } = useStyleTarget(target);
  const edit = target === "edit";
  const [open, setOpen] = useState(false);
  const changed = opts.first; // the dot marks a move off the default

  useEffect(() => {
    if (!open) return;
    // Esc closes just the popover, not the whole sheet (the sheet listens on window in the bubble phase)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Style options"
        data-tip="Style options"
        className={`hover-wash relative flex h-11 w-11 items-center justify-center rounded-m border transition-colors ${
          open || changed ? "border-gold/55 text-gold-text" : "border-line-strong text-text-2"
        }`}
      >
        <SlidersHorizontal size={18} strokeWidth={1.7} />
        {changed && <i className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold-ui" aria-hidden />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-m border border-line-strong bg-overlay p-3 shadow-xl">
            <p className="mb-1 text-[12.5px] leading-snug text-text-3">{edit ? "The style is sent as an instruction to restyle the whole image." : "The style text is added to your prompt when you generate."}</p>
            <div className="divide-y divide-line">
              <Toggle on={opts.first} onChange={(first) => setOpts({ ...opts, first })} label="Put the style first" sub={edit ? "Before your request instead of after it" : "Before your prompt instead of after it"} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A small inline switch for the pinned desktop header. */
function MiniToggle({ on, onChange, label, tip }: { on: boolean; onChange: (v: boolean) => void; label: string; tip: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} data-tip={tip} onClick={() => onChange(!on)} className="flex h-11 flex-none items-center gap-2 whitespace-nowrap text-[13.5px] text-text-2">
      {label}
      <span className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${on ? "bg-gold-ui" : "bg-track"}`}>
        <span className={`absolute left-[3px] top-[3px] h-4 w-4 rounded-full transition-transform ${on ? "translate-x-4 bg-on-gold-ui" : "bg-white"}`} />
      </span>
    </button>
  );
}

function Row({ active, title, text, thumb, onClick }: { active: boolean; title: string; text?: string; thumb?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-picked={active && !!text}
      className={`hover-wash relative flex h-full w-full flex-col items-start gap-2.5 rounded-m border px-3 py-2.5 text-left transition-colors ${
        active ? "border-gold/55 bg-gold-wash" : "border-line hover:border-line-strong"
      }`}
    >
      {thumb && (
        <img
          src={thumb}
          alt=""
          width={512}
          height={512}
          loading="lazy"
          decoding="async"
          onError={(e) => (e.currentTarget.style.display = "none")}
          className="aspect-square w-full flex-none rounded-s bg-raised object-cover"
        />
      )}
      <span className="min-w-0 w-full flex-1">
        <span className={`block text-[14px] ${active ? "text-gold-text" : "text-text"}`}>{title}</span>
        {text && <span className="mt-0.5 line-clamp-3 block text-[12px] leading-snug text-text-3">{text}</span>}
      </span>
      {active && <Check size={16} strokeWidth={1.9} className="absolute right-4 top-4 box-content text-gold-text rounded-full bg-black/60 p-1" aria-hidden />}
    </button>
  );
}

const useStyleSheet = () => {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
};

/** Mobile chip: shows the chosen style (or "Style") and opens the library. */
export function StyleChip({ target = "create" }: { target?: StyleTarget }) {
  const { style, setStyle } = useStyleTarget(target);
  const sheet = useStyleSheet();
  return (
    <>
      <Chip toggle={false} onClick={sheet.show} label={style ? `Style: ${style.name}. Tap to change` : "Pick a style"} tip="Add a style to your prompt">
        <Palette size={15} strokeWidth={1.7} className={style ? "text-gold-text" : undefined} />
        <span className="max-w-[9rem] truncate">{style?.name ?? "Style"}</span>
      </Chip>
      {style && (
        <button type="button" aria-label="Remove style" onClick={() => setStyle(null)} className="-ml-1.5 flex h-9 w-9 flex-none items-center justify-center rounded-full text-text-3 hover:text-text">
          <X size={15} strokeWidth={1.7} />
        </button>
      )}
      <StyleSheet open={sheet.open} onClose={sheet.close} target={target} />
    </>
  );
}

/** Desktop: a small pill inside the prompt box, bottom-left. */
export function StyleButton({ target = "create" }: { target?: StyleTarget }) {
  const { style, setStyle } = useStyleTarget(target);
  const sheet = useStyleSheet();
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={sheet.show}
        aria-label={style ? `Style: ${style.name}. Change` : "Pick a style"}
        data-tip="Add a style to your prompt"
        className={`hover-wash flex h-8 min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors ${
          style ? "border-gold/55 bg-gold-wash text-gold-text" : "border-line-strong text-text-2 hover:border-text-3 hover:text-text"
        }`}
      >
        <Palette size={14} strokeWidth={1.7} className="flex-none" aria-hidden />
        <span className="max-w-[11rem] truncate">{style?.name ?? "Style"}</span>
      </button>
      {style && (
        <button
          type="button"
          aria-label="Remove style"
          onClick={() => setStyle(null)}
          className="hover-wash flex h-8 w-8 flex-none items-center justify-center rounded-full text-text-3 transition-colors hover:text-text"
        >
          <X size={14} strokeWidth={1.7} />
        </button>
      )}
      <StyleSheet open={sheet.open} onClose={sheet.close} target={target} />
    </div>
  );
}
