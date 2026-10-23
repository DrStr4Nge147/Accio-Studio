import { useEffect, useRef } from "react";
import { Ring } from "../Wordmark";

const LOGO = 56; // css px, matches the h-14 w-14 logo it stands in for
const PAD_X = 20;
const PAD_TOP = 48; // headroom above the logo for the rising particles
const CELL = 1.5; // css px per particle
const ERODE = 0.62; // top share of the logo that peels away

interface Cell {
  hx: number; // home, canvas css px
  hy: number;
  e: number; // 0 = stays put, up to 1 = the very top
  period: number; // s
  phase: number;
  wob: number;
  color: string;
}

const resolve = (el: Element, v: string) => getComputedStyle(el).getPropertyValue(v).trim() || "#f6cd7c";

/**
 * The cancel state of the card: the logo itself, rebuilt out of small squares. Its top part keeps coming apart: each square
 * lets go of its spot, drifts up and fades, then returns to its place, so the particles really come out of the logo.
 */
export function LogoDust() {
  const host = useRef<HTMLDivElement>(null);
  const src = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    const svg = src.current?.querySelector("svg");
    const cv = canvas.current;
    if (!svg || !cv || !host.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const CW = LOGO + PAD_X * 2;
    const CH = LOGO + PAD_TOP;
    cv.width = Math.round(CW * dpr);
    cv.height = Math.round(CH * dpr);
    const ctx = cv.getContext("2d")!;

    // Serialize the live mark with its theme colours baked in, so it can be rasterised.
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(LOGO * dpr));
    clone.setAttribute("height", String(LOGO * dpr));
    clone.setAttribute("style", `color:${getComputedStyle(host.current).color};overflow:visible`);
    const markup = clone.outerHTML.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(document.documentElement, name));
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const S = Math.round(LOGO * dpr);
      const off = document.createElement("canvas");
      off.width = off.height = S;
      const octx = off.getContext("2d", { willReadFrequently: true })!;
      octx.drawImage(img, 0, 0, S, S);
      const data = octx.getImageData(0, 0, S, S).data;
      const step = Math.max(1, Math.round(CELL * dpr));
      const cells: Cell[] = [];
      for (let y = 0; y < S; y += step) {
        for (let x = 0; x < S; x += step) {
          const i = ((y + (step >> 1)) * S + x + (step >> 1)) * 4;
          if (data[i + 3]! < 110) continue;
          const yf = y / S;
          cells.push({
            hx: PAD_X + x / dpr,
            hy: PAD_TOP + y / dpr,
            e: Math.max(0, (ERODE - yf) / ERODE),
            period: 2.2 + Math.random() * 2.2,
            phase: Math.random(),
            wob: Math.random() * Math.PI * 2,
            color: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`,
          });
        }
      }
      const px = CELL;
      const t0 = performance.now();
      const frame = (now: number) => {
        const t = (now - t0) / 1000;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, CW, CH);
        for (const c of cells) {
          let x = c.hx;
          let y = c.hy;
          let a = 1;
          if (c.e > 0 && !reduced) {
            const u = (t / c.period + c.phase) % 1;
            const u0 = 0.12 + (1 - c.e) * 0.55; // the higher the square, the sooner it lets go
            if (u > u0) {
              const q = (u - u0) / (1 - u0);
              y -= Math.pow(q, 1.2) * (10 + c.e * 34);
              x += Math.sin(q * 5 + c.wob) * 1.6 * q;
              a = 1 - q;
            } else if (u < 0.08) a = u / 0.08; // returns to its spot softly
          }
          ctx.globalAlpha = a;
          ctx.fillStyle = c.color;
          ctx.fillRect(x, y, px, px);
        }
        if (!reduced) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={host} className="relative h-14 w-14" aria-hidden>
      <div ref={src} className="pointer-events-none absolute inset-0 opacity-0">
        <Ring className="h-14 w-14" />
      </div>
      <canvas ref={canvas} className="pointer-events-none absolute" style={{ left: -PAD_X, top: -PAD_TOP, width: LOGO + PAD_X * 2, height: LOGO + PAD_TOP }} />
    </div>
  );
}
