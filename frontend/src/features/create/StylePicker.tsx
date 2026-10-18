import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Palette, Search, X } from "lucide-react";
import { Chip } from "../../components/ui/controls";
import { Sheet } from "../../components/ui/Sheet";
import { useCreate } from "./store";
import { loadStyles, type StyleDef } from "./styles";

const ALL = "All";

/** The sheet that lists the style library; picking a row sets the style and closes it. */
function StyleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const style = useCreate((s) => s.style);
  const patch = useCreate((s) => s.patch);
  const [styles, setStyles] = useState<StyleDef[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);

  useEffect(() => {
    if (!open || styles) return;
    setFailed(false);
    loadStyles().then(setStyles, () => setFailed(true));
  }, [open, styles]);

  const categories = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of styles ?? []) for (const c of s.categories) count.set(c, (count.get(c) ?? 0) + 1);
    return [ALL, ...[...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!)];
  }, [styles]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (styles ?? []).filter(
      (s) => (category === ALL || s.categories.includes(category)) && (!q || s.name.toLowerCase().includes(q) || s.descriptor.toLowerCase().includes(q)),
    );
  }, [styles, query, category]);

  const pick = (next: StyleDef | null) => {
    patch({ style: next && { id: next.id, name: next.name } });
    onClose();
  };

  // Portaled to <body>: inside the composer dock (its own stacking context, clipped chip row) the sheet rendered half-hidden on phones.
  return createPortal(
    <Sheet open={open} onClose={onClose} title="Style" height="88%" desktopModalWidth={640}>
      <p className="mb-3 text-[13px] leading-snug text-text-2">The style is added after your prompt when you generate. Your own words stay in charge of the subject.</p>
      <div className="relative">
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
      <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 py-1">
        {categories.map((c) => (
          <Chip key={c} toggle={false} onClick={() => setCategory(c)} label={`Category: ${c}`}>
            <span className={c === category ? "text-gold-text" : undefined}>{c}</span>
          </Chip>
        ))}
      </div>
      <ul className="mt-2 space-y-1.5">
        <li>
          <Row active={!style} title="No style" onClick={() => pick(null)} />
        </li>
        {styles === null && <li className="py-6 text-center text-[13px] text-text-3">{failed ? "Couldn't load the styles." : "Loading styles…"}</li>}
        {styles && shown.length === 0 && <li className="py-6 text-center text-[13px] text-text-3">No styles match.</li>}
        {shown.map((s) => (
          <li key={s.id}>
            <Row active={style?.id === s.id} title={s.name} text={s.descriptor} onClick={() => pick(s)} />
          </li>
        ))}
      </ul>
    </Sheet>,
    document.body,
  );
}

function Row({ active, title, text, onClick }: { active: boolean; title: string; text?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`hover-wash flex w-full items-start gap-2 rounded-m border px-3 py-2.5 text-left transition-colors ${
        active ? "border-gold/55 bg-gold-wash" : "border-line hover:border-line-strong"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] ${active ? "text-gold-text" : "text-text"}`}>{title}</span>
        {text && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-text-3">{text}</span>}
      </span>
      {active && <Check size={16} strokeWidth={1.9} className="mt-0.5 flex-none text-gold-text" aria-hidden />}
    </button>
  );
}

const useStyleSheet = () => {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
};

/** Mobile chip: shows the chosen style (or "Style") and opens the library. */
export function StyleChip() {
  const style = useCreate((s) => s.style);
  const sheet = useStyleSheet();
  return (
    <>
      <Chip toggle={false} onClick={sheet.show} label={style ? `Style: ${style.name}. Tap to change` : "Pick a style"} tip="Add a style to your prompt">
        <Palette size={15} strokeWidth={1.7} className={style ? "text-gold-text" : undefined} />
        <span className="max-w-[9rem] truncate">{style?.name ?? "Style"}</span>
      </Chip>
      <StyleSheet open={sheet.open} onClose={sheet.close} />
    </>
  );
}

/** Desktop: a small pill inside the prompt box, bottom-left. */
export function StyleButton() {
  const style = useCreate((s) => s.style);
  const patch = useCreate((s) => s.patch);
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
          onClick={() => patch({ style: null })}
          className="hover-wash flex h-8 w-8 flex-none items-center justify-center rounded-full text-text-3 transition-colors hover:text-text"
        >
          <X size={14} strokeWidth={1.7} />
        </button>
      )}
      <StyleSheet open={sheet.open} onClose={sheet.close} />
    </div>
  );
}
