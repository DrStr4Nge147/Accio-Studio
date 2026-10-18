export interface StyleDef {
  id: string;
  name: string;
  descriptor: string;
  /** short concrete visual cues for few-step models */
  compact: string;
  categories: string[];
}

let cache: Promise<StyleDef[]> | null = null;

/** The style library is ~220 KB, so it loads on first use instead of weighing down the main bundle. */
export function loadStyles(): Promise<StyleDef[]> {
  cache ??= import("./styles.json").then((m) => m.default as StyleDef[]);
  return cache;
}

export interface StyleOpts {
  /** the short, concrete cue list instead of the full descriptor (usually works better for few-step models) */
  compact: boolean;
  /** put the style before your prompt instead of after it */
  first: boolean;
}
export const STYLE_OPTS: StyleOpts = { compact: true, first: false };

/** What gets added to the prompt for a style: the compact cues, or the full descriptor. */
export const styleText = (s: StyleDef, compact = true) => (compact ? s.compact : s.descriptor);

const END_PUNCT = /[.!?,;:]$/;

/** Your prompt and the style text as two sentences, in the order asked. */
export function withStyle(prompt: string, text: string | undefined, first = false): string {
  const p = prompt.trim();
  if (!text) return p;
  if (!p) return text;
  if (first) return `${text}${END_PUNCT.test(text) ? "" : "."} ${p}`;
  return `${p}${END_PUNCT.test(p) ? " " : ". "}${text}`;
}

// Each form a style can have been written in; "Name. descriptor" is the older wording, still recognized on reuse.
const VARIANTS: { compact: boolean; text: (s: StyleDef) => string }[] = [
  { compact: false, text: (s) => `${s.name}. ${s.descriptor}` },
  { compact: false, text: (s) => s.descriptor },
  { compact: true, text: (s) => s.compact },
];

/** Inverse of withStyle, for "Reuse settings": the prompt without the style, and which style (and options) it was. */
export function splitStyle(prompt: string, styles: StyleDef[]): { prompt: string; style: StyleDef | null; opts: StyleOpts } {
  for (const s of styles) {
    for (const v of VARIANTS) {
      const text = v.text(s);
      const lead = `${text}${END_PUNCT.test(text) ? "" : "."} `;
      if (prompt === text) return { prompt: "", style: s, opts: { compact: v.compact, first: false } };
      if (prompt.startsWith(lead)) return { prompt: prompt.slice(lead.length), style: s, opts: { compact: v.compact, first: true } };
      if (prompt.endsWith(text)) {
        const head = prompt.slice(0, prompt.length - text.length);
        if (head.endsWith(". ")) return { prompt: head.slice(0, -2), style: s, opts: { compact: v.compact, first: false } };
        if (head.endsWith(" ") && END_PUNCT.test(head.trimEnd())) return { prompt: head.trimEnd(), style: s, opts: { compact: v.compact, first: false } };
      }
    }
  }
  return { prompt, style: null, opts: STYLE_OPTS };
}
