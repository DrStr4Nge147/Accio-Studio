// WCAG contrast check for the design tokens in frontend/src/index.css.
// Usage: node scripts/check-contrast.mjs   (exit code 1 if any pair is below its threshold)
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../frontend/src/index.css", import.meta.url), "utf8");

function tokens(selector) {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const dark = tokens(":root {");
const light = { ...dark, ...tokens(':root[data-theme="light"]') };

const rgb = (c) => {
  if (c.startsWith("#")) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const m = c.match(/rgba?\(([^)]+)\)/);
  return m[1].split(",").slice(0, 3).map(Number);
};
const alpha = (c) => (c.startsWith("rgba") ? Number(c.match(/rgba?\(([^)]+)\)/)[1].split(",")[3]) : 1);
const over = (fg, bg) => rgb(fg).map((v, i) => v * alpha(fg) + rgb(bg)[i] * (1 - alpha(fg)));
const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground token, background token, minimum ratio, what it is]
const PAIRS = [
  ["text", "bg", 4.5, "body text"],
  ["text", "surface", 4.5, "text on panels"],
  ["text", "raised", 4.5, "text in inputs"],
  ["text-2", "bg", 4.5, "secondary text"],
  ["text-2", "surface", 4.5, "secondary text on panels"],
  ["text-2", "raised", 4.5, "secondary text in inputs"],
  ["text-3", "bg", 4.5, "hints"],
  ["text-3", "surface", 4.5, "hints on panels"],
  ["text-3", "raised", 4.5, "hints in inputs"],
  ["gold-text", "bg", 4.5, "gold text"],
  ["gold-text", "surface", 4.5, "gold text on panels"],
  ["gold-text", "gold-wash/surface", 4.5, "gold text on an active chip"],
  ["on-gold", "gold", 4.5, "label on the gold button"],
  ["on-gold", "gold-hi", 4.5, "label on the gold button (top of gradient)"],
  ["ok", "surface", 4.5, "success text"],
  ["danger", "surface", 4.5, "error text"],
  ["danger", "bg", 4.5, "error text on the canvas"],
  ["gold-ui", "bg", 3, "focus ring, switch, fills on the canvas"],
  ["gold-ui", "surface", 3, "focus ring, switch, fills on panels"],
  ["gold-ui", "raised", 3, "fills on raised surfaces"],
  ["track", "bg", 3, "switch off-state / unfilled track boundary"],
  ["track", "surface", 3, "switch off-state on panels"],
];

let failed = 0;
for (const [name, t] of [["dark", dark], ["light", light]]) {
  console.log(`\n${name} theme`);
  for (const [fg, bgKey, min, what] of PAIRS) {
    const [bgName, base] = bgKey.split("/");
    const bg = base ? over(t[bgName], t[base]) : rgb(t[bgKey]);
    const r = ratio(rgb(t[fg]), bg);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}  (min ${min})  ${fg} on ${bgKey}  - ${what}`);
  }
}
process.exit(failed ? 1 : 0);
