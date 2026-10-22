export interface StyleDef {
  id: string;
  name: string;
  /** short concrete visual cues for few-step models; this is the only style text Create and Edit send */
  compact: string;
  categories: string[];
  /** a thumbnail exists at stylePreviewUrl(id), for both Create and Edit */
  preview?: boolean;
}

/** Create and Edit have their own thumbnails: the same sample photo, generated through each mode. */
export const stylePreviewUrl = (id: string, edit = false) => `/style-previews${edit ? "-edit" : ""}/${id}.webp`;

let cache: Promise<StyleDef[]> | null = null;

/** The style library is ~100 KB, so it loads on first use instead of weighing down the main bundle. */
export function loadStyles(): Promise<StyleDef[]> {
  cache ??= import("./styles.json").then((m) => m.default as StyleDef[]);
  return cache;
}

export interface StyleOpts {
  /** put the style before your prompt instead of after it */
  first: boolean;
}
export const STYLE_OPTS: StyleOpts = { first: false };

const LABEL = "Art style: ";

/** What gets added to the prompt for a style: its compact cues, labeled so the model reads them as how to render rather than what to draw. */
export const styleText = (s: StyleDef) => LABEL + s.compact;

const EDIT_HEAD =
  "Preserve the original subject identity, recognizable facial features, key objects, pose, body proportions, composition, camera angle, framing, and spatial layout unless the user's edit request explicitly asks to change them. Re-render all visible elements consistently with these visual characteristics: ";
const EDIT_TAIL =
  " Keep the result visually coherent and faithful to the source image. Do not introduce unrelated objects, text, logos, extra limbs, altered anatomy, or major structural changes unless specifically requested.";

/** The instruction Edit (Qwen Image Edit 2.1, Klein) gets for a style: restyle the whole image, keep what is in it. */
export const editStyleText = (s: StyleDef) => `Transform the entire input image into ${s.name}. ${EDIT_HEAD}${s.compact}.${EDIT_TAIL}`;

const END_PUNCT = /[.!?,;:]$/;

/** Your prompt and the style text as two sentences, in the order asked. */
export function withStyle(prompt: string, text: string | undefined, first = false): string {
  const p = prompt.trim();
  if (!text) return p;
  if (!p) return text;
  if (first) return `${text}${END_PUNCT.test(text) ? "" : "."} ${p}`;
  return `${p}${END_PUNCT.test(p) ? " " : ". "}${text}`;
}

// Each form a style can have been written in; the unlabeled wording is older, still recognized on reuse. (Jobs made with the long descriptor, which no longer exists, are not recognized.)
const VARIANTS: Variant[] = [{ text: (s) => styleText(s) }, { text: (s) => s.compact }];

type Variant = { text: (s: StyleDef) => string };

function splitWith(prompt: string, styles: StyleDef[], variants: Variant[], fallback: StyleOpts) {
  for (const s of styles) {
    for (const v of variants) {
      const text = v.text(s);
      const lead = `${text}${END_PUNCT.test(text) ? "" : "."} `;
      if (prompt === text) return { prompt: "", style: s, opts: { first: false } };
      if (prompt.startsWith(lead)) return { prompt: prompt.slice(lead.length), style: s, opts: { first: true } };
      if (prompt.endsWith(text)) {
        const head = prompt.slice(0, prompt.length - text.length);
        if (head.endsWith(". ")) return { prompt: head.slice(0, -2), style: s, opts: { first: false } };
        if (head.endsWith(" ") && END_PUNCT.test(head.trimEnd())) return { prompt: head.trimEnd(), style: s, opts: { first: false } };
      }
    }
  }
  return { prompt, style: null as StyleDef | null, opts: fallback };
}

/** Inverse of withStyle, for "Reuse settings": the prompt without the style, and which style (and options) it was. */
export const splitStyle = (prompt: string, styles: StyleDef[]) => splitWith(prompt, styles, VARIANTS, STYLE_OPTS);

const EDIT_VARIANTS: Variant[] = [{ text: (s) => editStyleText(s) }];

/** Same for an Edit prompt: the template, whichever order and wording it was written in. */
export const splitEditStyle = (prompt: string, styles: StyleDef[]) => splitWith(prompt, styles, EDIT_VARIANTS, STYLE_OPTS);
