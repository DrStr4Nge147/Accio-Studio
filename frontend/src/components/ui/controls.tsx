import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/** Pill toggle for the main options (36 px visual, 44 px hit area via padding). */
export function Chip({
  on,
  onClick,
  children,
  toggle = true,
  label,
  tip,
}: {
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
  /** false = plain action chip (cycle / open), no on-state dot */
  toggle?: boolean;
  label?: string;
  tip?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={toggle ? !!on : undefined}
      aria-label={label}
      data-tip={tip}
      className="group -my-1 flex-none py-1.5 first:ml-0"
    >
      <span
        className={cx(
          "flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors",
          on ? "border-gold/55 bg-gold-wash text-gold-text group-hover:border-gold" : "border-line-strong text-text-2 group-hover:border-text-3 group-hover:bg-raised group-hover:text-text",
        )}
      >
        {toggle && <i className={cx("h-[7px] w-[7px] rounded-full", on ? "bg-gold-ui" : "bg-text-3")} />}
        {children}
      </span>
    </button>
  );
}

/**
 * A sideways-scrolling strip whose edges fade only while more content is hidden past them. Returns the ref for the
 * scrolling element and the mask style to put on it.
 */
export function useScrollFade<T extends HTMLElement>(deps: unknown) {
  const ref = useRef<T>(null);
  const [more, setMore] = useState({ l: false, r: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore({ l: el.scrollLeft > 1, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [deps]);
  const mask = `linear-gradient(to right, ${more.l ? "transparent, #000 20px" : "#000"}, ${more.r ? "#000 calc(100% - 28px), transparent" : "#000"})`;
  return { ref, style: { maskImage: mask, WebkitMaskImage: mask } };
}

/** Mobile row of chips under the prompt: the chips scroll sideways and `end` (the Options chip) stays pinned at the right. */
export function ChipRow({ children, end }: { children: ReactNode; end?: ReactNode }) {
  const fade = useScrollFade<HTMLDivElement>(children);
  return (
    <div className="flex items-center gap-1.5">
      <div ref={fade.ref} style={fade.style} className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
        {children}
      </div>
      {end}
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  sub,
  disabled,
  tip,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: ReactNode;
  disabled?: boolean;
  tip?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      data-tip={tip}
      onClick={() => onChange(!on)}
      className="flex min-h-11 w-full items-center justify-between gap-3 py-1 text-left text-[14px] disabled:opacity-50"
    >
      <span className="min-w-0">
        {label}
        {sub && <span className="block text-[12px] text-text-3">{sub}</span>}
      </span>
      <span className={cx("relative h-[26px] w-11 flex-none rounded-[13px] transition-colors", on ? "bg-gold-ui" : "bg-track")}>
        <span
          className={cx(
            "absolute left-[3px] top-[3px] h-5 w-5 rounded-full transition-transform",
            on ? "translate-x-[18px] bg-on-gold-ui" : "bg-white",
          )}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  small,
}: {
  value: T;
  options: { value: T; label: ReactNode; tip?: string }[];
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-xl border border-line bg-raised p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-tip={o.tip}
          onClick={() => onChange(o.value)}
          className={cx(
            "grid place-items-center whitespace-nowrap rounded-[9px] px-3.5 text-[13px] font-medium transition-colors",
            small ? "h-8 min-w-9" : "h-9 min-w-11",
            o.value === value ? "bg-overlay text-text" : "text-text-2 hover:bg-overlay/60 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  format = (v) => v.toFixed(2),
  disabled,
  tip,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
  disabled?: boolean;
  tip?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={disabled ? "opacity-50" : undefined}>
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-text-2" data-tip={tip}>{label}</span>
        <span className="font-mono text-[13px] text-text">{format(value)}</span>
      </div>
      <input
        type="range"
        className="slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ["--pct" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function IconButton({
  children,
  label,
  className,
  ...rest
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      {...rest}
      className={cx("hover-wash grid h-11 w-11 flex-none place-items-center rounded-full text-text-2 transition-colors hover:text-text disabled:opacity-40", className)}
    >
      {children}
    </button>
  );
}

export function Label({ children, tip }: { children: ReactNode; tip?: string }) {
  return (
    <div className="w-fit text-[12px] font-medium tracking-wide text-text-3" data-tip={tip}>
      {children}
    </div>
  );
}

export function Field({ label, children, tip }: { label: string; children: ReactNode; tip?: string }) {
  return (
    <label className="block">
      <Label tip={tip}>{label}</Label>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export const inputCls =
  "h-11 w-full rounded-s border border-line bg-raised px-3 text-[14px] text-text outline-none focus:border-gold";
