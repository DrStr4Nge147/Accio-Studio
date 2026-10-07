const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const MAX_LINES = 2000;

/** Terminal-style append: `\n` starts a new line, a lone `\r` returns to column 0 so progress bars redraw in place.
 *  The last element is the open line; it ends in `\r` while a redraw is pending. */
export function appendLog(lines: string[], chunk: string): string[] {
  const out = lines.length ? lines.slice() : [""];
  const pieces = chunk.replace(ANSI, "").replace(/\r\n/g, "\n").split("\n");
  pieces.forEach((piece, i) => {
    if (i > 0) out.push("");
    const segs = (out[out.length - 1] + piece).split("\r");
    const last = segs[segs.length - 1]!;
    out[out.length - 1] = last !== "" || segs.length === 1 ? last : (segs[segs.length - 2] ?? "") + "\r";
  });
  return out.length > MAX_LINES ? out.slice(out.length - MAX_LINES) : out;
}

export const showLine = (line: string) => line.replace(/\r$/, "");
