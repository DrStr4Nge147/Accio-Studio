import { useState } from "react";
import { ParticleReveal } from "./ParticleReveal";

/**
 * Inpaint result landing: the untouched "before" stays in place and particles of the new picture settle into the painted
 * shape, so the picture never looks reset. The real result fades in under them.
 */
export function LocalReveal({ url, before, mask, w, h, alt, onLoad, onDone }: {
  url: string;
  before: string;
  mask: string; // the painted shape (transparent PNG)
  w: number;
  h: number;
  alt: string;
  onLoad: (img: HTMLImageElement) => void;
  onDone: () => void;
}) {
  const [ready, setReady] = useState(false); // waits for the particles to be built
  const shape = { WebkitMaskImage: `url(${mask})`, maskImage: `url(${mask})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" } as const;

  return (
    <div className="relative h-full w-full">
      <img src={before} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
      <div className="absolute inset-0" style={shape}>
        <img
          src={url}
          alt={alt}
          width={w}
          height={h}
          decoding="async"
          draggable={false}
          className={`h-full w-full object-contain ${ready ? "particle-img" : "opacity-0"}`}
          onLoad={(e) => onLoad(e.currentTarget)}
          onAnimationEnd={onDone}
        />
      </div>
      <ParticleReveal mask={mask} result={url} onReady={() => setReady(true)} />
    </div>
  );
}
