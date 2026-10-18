export interface StyleDef {
  id: string;
  name: string;
  descriptor: string;
  categories: string[];
}

let cache: Promise<StyleDef[]> | null = null;

/** The style library is ~220 KB, so it loads on first use instead of weighing down the main bundle. */
export function loadStyles(): Promise<StyleDef[]> {
  cache ??= import("./styles.json").then((m) => m.default as StyleDef[]);
  return cache;
}

const END_PUNCT = /[.!?,;:]$/;

/** Your prompt first, then the style's descriptor as a following sentence. */
export function withStyle(prompt: string, descriptor: string | undefined): string {
  const p = prompt.trim();
  if (!descriptor) return p;
  if (!p) return descriptor;
  return `${p}${END_PUNCT.test(p) ? " " : ". "}${descriptor}`;
}

/** Inverse of withStyle, for "Reuse settings": the prompt without the trailing style, and which style it was. */
export function splitStyle(prompt: string, styles: StyleDef[]): { prompt: string; style: StyleDef | null } {
  for (const s of styles) {
    if (prompt === s.descriptor) return { prompt: "", style: s };
    if (prompt.endsWith(s.descriptor)) {
      const head = prompt.slice(0, prompt.length - s.descriptor.length);
      if (head.endsWith(". ")) return { prompt: head.slice(0, -2), style: s };
      if (head.endsWith(" ") && END_PUNCT.test(head.trimEnd())) return { prompt: head.trimEnd(), style: s };
    }
  }
  return { prompt, style: null };
}
