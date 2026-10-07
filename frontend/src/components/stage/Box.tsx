import type { ReactNode } from "react";

/**
 * A box with a fixed aspect ratio that fits inside its parent (contain). The parent must have a definite size; it
 * becomes a size container so the box can be sized with container units: no layout shift while images load.
 */
export function FitBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex h-full min-h-0 w-full items-center justify-center [container-type:size] ${className ?? ""}`}>
      {children}
    </div>
  );
}

export function Box({ w, h, children, className }: { w: number; h: number; children: ReactNode; className?: string }) {
  return (
    <FitBox>
      <div
        // inline-size container: controls inside can shrink when the picture is narrower than they are
        className={`relative [container-type:inline-size] ${className ?? ""}`}
        style={{ aspectRatio: `${w} / ${h}`, width: `min(100cqw, 100cqh * ${w / h})` }}
      >
        {children}
      </div>
    </FitBox>
  );
}
