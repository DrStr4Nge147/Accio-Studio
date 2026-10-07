import { useId } from "react";

/** Outlines of "acci" traced from the approved logo artwork (user-supplied, 2026-10-07). Coordinates share a space with MARK_AT below. */
const LETTERS = "M504.0 325.8C457.8 323.3 427.0 286.9 434.7 243.9C438.9 220.1 455.0 199.4 478.2 187.5C498.7 177.1 524.1 174.5 547.4 180.6C557.9 183.3 571.2 191.0 571.2 194.2C571.2 196.2 563.2 219.1 560.5 224.9C559.4 227.2 558.4 227.3 558.1 225.2C553.6 193.7 537.5 178.1 513.7 182.1C485.5 187.0 464.9 224.4 471.5 259.0C473.0 266.7 474.3 271.1 476.7 277.0C491.8 314.5 537.1 327.0 569.6 302.7C574.2 299.3 575.5 298.8 575.5 300.4C575.5 301.3 572.9 303.8 568.5 307.1C561.0 312.7 557.3 314.8 546.8 319.2C534.5 324.3 519.2 326.7 504.0 325.8ZM168.5 325.2C130.5 319.4 120.0 283.0 150.6 262.8C158.5 257.5 170.6 252.8 190.9 246.8C223.2 237.2 236.1 227.3 236.1 211.8C236.1 194.7 221.2 184.3 200.4 186.9C182.3 189.1 166.9 199.3 155.3 216.8C153.0 220.3 151.9 220.7 150.4 218.7C147.4 214.6 156.8 202.5 169.5 194.1C206.4 169.7 259.4 175.1 273.0 204.6C276.6 212.3 276.5 211.4 276.5 257.7C276.5 299.7 276.5 300.5 278.0 306.0C280.1 314.0 284.4 317.2 291.7 316.3C297.7 315.5 291.1 320.8 282.8 323.4C260.6 330.5 240.8 320.1 238.0 299.9C237.9 298.9 237.6 297.5 237.5 296.8C237.3 296.2 237.1 294.4 237.0 292.9C236.7 288.1 236.2 288.0 233.5 292.2C218.3 316.3 193.3 329.0 168.5 325.2ZM364.1 325.6C363.7 325.6 361.9 325.4 360.1 325.2C358.3 325.1 355.8 324.7 354.5 324.5C353.2 324.2 351.6 324.0 351.0 323.9C336.6 321.6 319.7 311.6 310.0 299.8C276.5 258.6 301.4 194.2 356.1 180.4C366.6 177.8 379.7 176.5 386.8 177.5C388.0 177.6 390.2 177.9 391.7 178.0C405.2 179.2 420.9 185.7 431.0 194.2C436.4 198.7 436.4 198.0 430.0 207.2C428.6 209.2 426.7 212.1 425.7 213.5C424.7 214.9 422.8 217.7 421.4 219.6C420.0 221.6 418.0 224.3 417.0 225.7C413.5 230.6 413.2 230.3 413.0 221.8C412.4 196.0 399.0 180.3 378.0 181.1C340.7 182.4 318.7 234.7 337.5 277.6C352.6 311.9 388.7 324.4 421.6 306.9C424.0 305.6 425.2 304.8 430.0 301.3C433.3 299.0 434.1 300.1 431.3 303.0C424.4 310.3 408.0 319.4 396.1 322.3C385.6 325.0 370.9 326.5 364.1 325.6ZM583.4 323.7C579.0 323.5 578.2 323.1 580.4 322.5C585.6 321.1 590.4 317.9 592.8 314.3C594.6 311.6 595.4 309.1 596.5 302.9C597.3 298.7 597.2 210.7 596.4 206.0C594.8 196.5 591.7 192.2 584.4 190.0C581.0 188.9 582.2 187.8 587.5 187.0C588.4 186.9 591.1 186.4 593.5 186.0C595.9 185.6 600.1 184.8 602.8 184.4C605.4 183.9 609.7 183.1 612.2 182.6C627.7 179.6 628.2 179.5 629.2 180.4C629.9 181.0 629.9 181.0 629.9 242.2L629.9 303.4L630.7 306.5C633.0 315.4 637.1 319.6 645.6 322.1C648.1 322.8 648.2 322.9 647.8 323.3C647.4 323.7 643.8 323.7 608.0 323.8C596.1 323.8 585.1 323.8 583.4 323.7ZM203.0 310.2C218.0 307.3 231.8 293.8 236.1 277.8C236.9 274.5 237.5 229.8 236.7 228.3C236.1 227.1 235.6 227.3 231.7 231.2C225.5 237.1 221.2 239.9 204.4 249.0C177.6 263.5 167.9 276.0 171.2 292.0C173.8 305.0 188.0 313.1 203.0 310.2ZM610.0 167.0C599.3 166.1 591.7 155.6 593.9 144.8C598.0 124.7 626.3 124.2 631.4 144.1C634.3 155.3 623.9 168.0 612.6 167.2C612.4 167.2 611.2 167.1 610.0 167.0Z";

/**
 * The Accio mark: a rounded ring that is open on the right and cut by a slit on the left, a gold four-point spark above and
 * a gold cursor below. Same shape as the app icon; in the wordmark it is the final "o".
 * Geometry is in a 65 48 730 760 box (the box the icon artwork was measured in).
 */
const RING =
  "M265 125H542A200 200 0 0 1 742 325V548A200 200 0 0 1 542 748H265A200 200 0 0 1 65 548V325A200 200 0 0 1 265 125Z" +
  "M265 211H542A114 114 0 0 1 656 325V548A114 114 0 0 1 542 662H265A114 114 0 0 1 151 548V325A114 114 0 0 1 265 211Z";
const RING_CLIP = ["40,100 507,100 396,260 396,408 40,408", "40,465 396,465 396,613 507,773 40,773", "760,348 640,432 640,441 760,525"];
const SPARK = "M640 48Q656 194 795 210Q656 226 640 365Q624 226 490 210Q624 194 640 48Z";
const CURSOR = "M515 480L783 640L675 702L590 792Z";

function MarkShapes({ spark }: { spark: boolean }) {
  const uid = useId().replace(/:/g, "");
  return (
    <>
      <defs>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--gold-hi)" }} />
          <stop offset="1" style={{ stopColor: "var(--gold)" }} />
        </linearGradient>
        <clipPath id={`${uid}c`}>
          {RING_CLIP.map((points) => (
            <polygon key={points} points={points} />
          ))}
        </clipPath>
      </defs>
      <path d={RING} fill="currentColor" fillRule="evenodd" clipPath={`url(#${uid}c)`} />
      {spark && (
        <>
          <path d={SPARK} fill={`url(#${uid}g)`} />
          <path d={CURSOR} fill={`url(#${uid}g)`} stroke={`url(#${uid}g)`} strokeWidth="22" strokeLinejoin="round" />
        </>
      )}
    </>
  );
}

/** The mark on its own (loading and empty states, thumbnails). `spark` off leaves just the ring. */
export function Ring({ className = "h-[0.78em] w-[0.78em]", spark = true }: { className?: string; spark?: boolean }) {
  return (
    <svg viewBox="65 48 730 760" className={className} style={{ overflow: "visible" }} aria-hidden>
      <MarkShapes spark={spark} />
    </svg>
  );
}

// Places the mark as the final "o": outer ring 144 tall, left edge at x 656, top at y 179 (artwork space).
const MARK_AT = "translate(656 179) scale(0.2311) translate(-65 -125)";

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <svg
      viewBox="122 126 706 216"
      className="text-text"
      style={{ height: size * 0.9, width: "auto", display: "block" }}
      role="img"
      aria-label="Accio"
    >
      <path d={LETTERS} fill="currentColor" />
      <g transform={MARK_AT}>
        <MarkShapes spark />
      </g>
    </svg>
  );
}
