/** "accio": the final o is an open ring with a four-point spark entering it (design/proposal.html #ring). */
export function Ring({ className = "h-[0.78em] w-[0.78em]", spark = true }: { className?: string; spark?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={className} style={{ overflow: "visible" }} aria-hidden>
      <path d="M82 24A40 40 0 1 0 90 52" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
      {spark && (
        <path
          d="M92 14l3.6 9.4L105 27l-9.4 3.6L92 40l-3.6-9.4L79 27l9.4-3.6z"
          transform="translate(-14 0)"
          fill="var(--gold)"
        />
      )}
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span
      className="serif inline-flex items-center font-normal tracking-[-0.03em] text-text"
      style={{ fontSize: size, lineHeight: 1 }}
      aria-label="Accio"
      role="img"
    >
      <span aria-hidden>acci</span>
      <Ring className="mx-[0.02em] h-[0.78em] w-[0.78em]" />
    </span>
  );
}
