import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./controls";

/** Modal bottom sheet (mobile) with scrim, Esc, focus handling and drag-down-to-close on the handle. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  height = "78%",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="fade-in absolute inset-0 bg-[var(--scrim)]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ maxHeight: height }}
        className="sheet-in safe-b absolute inset-x-0 bottom-0 flex flex-col rounded-t-[24px] border-t border-line-strong bg-surface shadow-float outline-none lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-[480px] lg:-translate-x-1/2 lg:rounded-[24px] lg:border"
      >
        <div
          className="touch-none px-4 pb-1 pt-2"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            if (drag.current && e.clientY - drag.current.y > 48) onClose();
            drag.current = null;
          }}
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" />
          <div className="mt-2 flex items-center justify-between">
            <h2 className="serif text-[20px] font-medium">{title}</h2>
            <IconButton label="Close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
              <X size={20} strokeWidth={1.7} />
            </IconButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
