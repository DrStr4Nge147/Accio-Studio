import { CUSTOM, FIELDS, type BuilderMode } from "./options";

/** Chosen option id per field id. A missing field is "not specified": it is left out of the prompt. */
export type Selection = Record<string, string>;

/** Past this many words, long prompts start to contradict themselves (Krea 2 follows short, concrete ones best). */
export const LONG_PROMPT_WORDS = 80;

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const article = (s: string) => (/^[aeiou]/i.test(s) ? "an" : "a");
const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** A selection value that is typed-in text rather than a chip id (chip ids are slugs, which never hold a colon). */
export const CUSTOM_PREFIX = "custom:";
export const customText = (sel: Selection, field: string) => (sel[field]?.startsWith(CUSTOM_PREFIX) ? sel[field]!.slice(CUSTOM_PREFIX.length) : undefined);

/** The words for one field, or undefined when nothing (or an option that no longer exists) is chosen. */
function pick(mode: BuilderMode, sel: Selection, field: string): string | undefined {
  const id = sel[field];
  if (!id) return undefined;
  const typed = customText(sel, field)?.trim().replace(/\s+/g, " ").replace(/[.,;]+$/, "");
  if (id.startsWith(CUSTOM_PREFIX)) {
    const spec = CUSTOM[mode][field];
    return typed && spec ? (spec.wrap ? spec.wrap(typed) : typed) : undefined;
  }
  return FIELDS[mode].find((f) => f.id === field)?.options.find((o) => o.id === id)?.text;
}

const sentence = (parts: (string | undefined)[]) => parts.filter(Boolean).join(", ");

function character(sel: Selection): string {
  const t = (f: string) => pick("character", sel, f);
  const subject = [t("height"), t("age"), t("ethnicity"), t("gender") ?? "person"].filter(Boolean).join(" ");
  const opening = `${cap([t("framing"), t("look") ?? "photo"].filter(Boolean).join(" "))} of ${article(subject)} ${subject}`;
  const traits = [t("build"), t("hair")].filter((x): x is string => !!x);
  const gaze = t("gaze");
  const expression = t("expression");
  return sentence([
    opening + (traits.length ? ` with ${list(traits)}` : "") + (t("clothing") ? ` wearing ${t("clothing")}` : ""),
    t("pose"),
    expression && `with ${expression}`,
    gaze,
    t("setting"),
    t("angle"),
    t("lens"),
    t("lighting"),
    t("mood"),
  ]);
}

function scene(sel: Selection): string {
  const t = (f: string) => pick("scene", sel, f);
  const layers = [t("foreground") && `${t("foreground")} in the foreground`, t("distance") && `${t("distance")} in the distance`].filter((x): x is string => !!x);
  const opening = `${cap(t("composition") ?? "Wide landscape photo")} of ${t("place") ?? "a scenic landscape"}` + (layers.length ? ` with ${list(layers)}` : "");
  return sentence([opening, t("time"), t("weather"), t("season"), t("lighting"), t("mood"), t("lens"), t("people")]);
}

const endStop = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** The prompt for the chosen options, with the user's extra details as the last sentence. */
export function buildPrompt(mode: BuilderMode, sel: Selection, extra = ""): string {
  const main = endStop(mode === "character" ? character(sel) : scene(sel));
  const more = extra.trim();
  return more ? `${main} ${endStop(more)}` : main;
}

/** True when nothing is chosen and no extra text is written, so there is nothing worth applying. */
export const isEmpty = (sel: Selection, extra: string, mode: BuilderMode) => !extra.trim() && !FIELDS[mode].some((f) => pick(mode, sel, f.id));

/** A random selection: the core fields always, the rest about half the time. `rng` returns [0, 1). */
export function randomSelection(mode: BuilderMode, rng: () => number = Math.random): Selection {
  const out: Selection = {};
  for (const f of FIELDS[mode]) {
    if (!f.core && rng() >= 0.5) continue;
    out[f.id] = f.options[Math.floor(rng() * f.options.length)]!.id;
  }
  return out;
}
