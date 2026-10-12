import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { loadHint } from "../lib/loadHint";
import { useSystem } from "../store/system";

/** A soft "this is a lot for your PC" note under a size control. Renders nothing when the size is fine or the hardware is unknown. */
export function LoadNote({ mp, what }: { mp: number; what?: string }) {
  const info = useSystem((s) => s.info);
  const load = useSystem((s) => s.load);
  useEffect(load, [load]);
  const hint = loadHint(info, mp, what);
  if (!hint) return null;
  return (
    <p role="note" className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-gold-text">
      <TriangleAlert size={14} strokeWidth={1.7} className="mt-px flex-none" aria-hidden />
      {hint.text}
    </p>
  );
}
