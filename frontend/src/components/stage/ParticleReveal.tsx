import { useEffect, useRef } from "react";

const DURATION = 1700; // ms; the result image fades in over its last part (see .particle-img in index.css)
const MAX_PARTICLES = 2600;
const SAMPLE = 160; // longest side of the sampling grid

interface Particle {
  tx: number; // target, 0..1 of the picture
  ty: number;
  ox: number; // where it starts, relative to the target, in 0..1 of the picture's width
  oy: number;
  spin: number;
  delay: number; // 0..1 of DURATION
  size: number;
  color: string;
}

const GOLD = ["#f6cd7c", "#ffe9b8", "#e9b45a"];

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous"; // lets us read the pixel colours; falls back to gold if the server does not allow it
  img.src = src;
  return img.decode().then(() => img);
}

/** Pick particles at random spots inside the painted shape, each carrying the result's own colour at that spot. */
async function buildParticles(mask: string, result: string): Promise<Particle[]> {
  const [m, r] = await Promise.all([loadImage(mask), loadImage(result).catch(() => null)]);
  const k = Math.min(1, SAMPLE / Math.max(m.naturalWidth, m.naturalHeight));
  const w = Math.max(1, Math.round(m.naturalWidth * k));
  const h = Math.max(1, Math.round(m.naturalHeight * k));
  const grab = (img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const maskPx = grab(m);
  let colors: Uint8ClampedArray | null = null;
  try {
    colors = r ? grab(r) : null;
  } catch {
    colors = null; // tainted canvas
  }
  const spots: number[] = [];
  for (let i = 0; i < w * h; i++) if (maskPx[i * 4 + 3]! > 128) spots.push(i);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j]!, spots[i]!];
  }
  return spots.slice(0, MAX_PARTICLES).map((i) => {
    const gold = !colors || Math.random() < 0.12;
    const color = gold ? GOLD[Math.floor(Math.random() * GOLD.length)]! : `rgb(${colors![i * 4]},${colors![i * 4 + 1]},${colors![i * 4 + 2]})`;
    const a = Math.random() * Math.PI * 2;
    const d = 0.03 + Math.random() * 0.1;
    return {
      tx: ((i % w) + Math.random()) / w,
      ty: (Math.floor(i / w) + Math.random()) / h,
      ox: Math.cos(a) * d,
      oy: Math.sin(a) * d,
      spin: (Math.random() - 0.5) * 1.6,
      delay: Math.random() * 0.4,
      size: 0.8 + Math.random() * 1.4,
      color,
    };
  });
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Inpaint reveal: specks of the new picture, in its own colours, drift in from around the painted area and settle where they
 * belong. `onReady` fires once they are built, which is when the caller starts fading the real result in underneath.
 */
export function ParticleReveal({ mask, result, onReady }: { mask: string; result: string; onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    let alive = true;
    let raf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    buildParticles(mask, result)
      .catch(() => [] as Particle[])
      .then((parts) => {
        const cv = canvas.current;
        if (!alive) return;
        ready.current();
        if (!cv || reduced || !parts.length) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = (cv.width = Math.max(1, Math.round(cv.clientWidth * dpr)));
        const H = (cv.height = Math.max(1, Math.round(cv.clientHeight * dpr)));
        const ctx = cv.getContext("2d")!;
        const px = Math.max(1.5, W / 340);
        const t0 = performance.now();
        const frame = (now: number) => {
          const t = Math.min(1, (now - t0) / DURATION);
          ctx.clearRect(0, 0, W, H);
          const fade = t > 0.62 ? 1 - (t - 0.62) / 0.38 : 1;
          for (const p of parts) {
            const l = Math.min(1, Math.max(0, (t - p.delay) / 0.5));
            const e = ease(l);
            const back = 1 - e;
            const cos = Math.cos(back * p.spin);
            const sin = Math.sin(back * p.spin);
            const x = (p.tx + (p.ox * cos - p.oy * sin) * back) * W;
            const y = (p.ty + ((p.ox * sin + p.oy * cos) * back * W) / H) * H;
            ctx.globalAlpha = Math.min(1, l * 3) * Math.max(0, fade);
            ctx.fillStyle = p.color;
            const s = px * p.size;
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
          }
          if (t < 1) raf = requestAnimationFrame(frame);
          else ctx.clearRect(0, 0, W, H);
        };
        raf = requestAnimationFrame(frame);
      });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [mask, result]);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 z-[1] h-full w-full" />;
}
