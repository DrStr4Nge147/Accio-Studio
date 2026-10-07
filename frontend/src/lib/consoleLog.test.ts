import { describe, expect, it } from "vitest";
import { appendLog, MAX_LINES, showLine } from "./consoleLog";

describe("appendLog", () => {
  it("splits lines and keeps the open line for the next chunk", () => {
    let l = appendLog([], "got prompt\nloading mo");
    expect(l).toEqual(["got prompt", "loading mo"]);
    l = appendLog(l, "del\nready\n");
    expect(l).toEqual(["got prompt", "loading model", "ready", ""]);
  });

  it("redraws a progress bar in place", () => {
    let l = appendLog([], "  0%|          | 0/20\r");
    l = appendLog(l, " 50%|#####     | 10/20\r");
    l = appendLog(l, "100%|##########| 20/20\r\n");
    expect(l.map(showLine)).toEqual(["100%|##########| 20/20", ""]);
  });

  it("treats CRLF as a line break and drops colour codes", () => {
    expect(appendLog([], "\x1b[32mok\x1b[0m\r\nnext").map(showLine)).toEqual(["ok", "next"]);
  });

  it("keeps only the newest lines", () => {
    const l = appendLog([], Array.from({ length: MAX_LINES + 50 }, (_, i) => `l${i}`).join("\n"));
    expect(l).toHaveLength(MAX_LINES);
    expect(l[l.length - 1]).toBe(`l${MAX_LINES + 49}`);
  });
});
