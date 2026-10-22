import { useEffect, type ReactNode } from "react";

/** In-app confirmation (a small centered modal) in place of the browser's confirm box. Sits above sheets. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation(); // closes this dialog, not the sheet under it
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="fade-in absolute inset-0 bg-[var(--scrim)]" onClick={busy ? undefined : onCancel} aria-hidden />
      <div role="alertdialog" aria-modal="true" aria-label={title} className="fade-in relative w-full max-w-sm rounded-[20px] border border-line-strong bg-surface p-5 shadow-float">
        <h2 className="serif text-[20px] font-medium">{title}</h2>
        <div className="mt-2 text-[14px] text-text-2">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="hover-wash h-11 rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text disabled:opacity-50">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={onConfirm} className="h-11 rounded-full bg-danger px-5 text-[14px] font-semibold text-white disabled:opacity-50">
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
