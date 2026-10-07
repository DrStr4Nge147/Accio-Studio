export interface TagTrigger {
  /** index of the first character of the token being typed */
  start: number;
  /** caret position (end of the token) */
  end: number;
  /** digits typed after "image" (filters the list), "" if none */
  digits: string;
}

/**
 * Is the caret at the end of something that looks like the start of an image tag: `<`, `<im`, `<image2`, or a bare `im`,
 * `image`, `image2`? Bare "i" is ignored on purpose (it is every other word). Returns the token's span, or null.
 */
export function detectTagTrigger(text: string, caret: number): TagTrigger | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(,.;:])(<(?:i(?:m(?:a(?:g(?:e\d*)?)?)?)?)?|im(?:a(?:g(?:e\d*)?)?)?)$/i.exec(before);
  if (!m) return null;
  const token = m[2]!;
  return { start: caret - token.length, end: caret, digits: /(\d+)$/.exec(token)?.[1] ?? "" };
}

/** Replace the typed token with a finished tag plus a space; returns the new text and where the caret goes. */
export function applyTag(text: string, t: TagTrigger, n: number): { text: string; caret: number } {
  const tag = `<image${n}> `;
  // Text right after the caret that already is the tail of a tag ("<image1>" typed in full) is absorbed.
  const after = text.slice(t.end).replace(/^[\d]*>?/, "");
  return { text: text.slice(0, t.start) + tag + after, caret: t.start + tag.length };
}
