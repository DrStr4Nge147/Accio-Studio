import { applyReuse, useReusePrompt } from "../features/reuse";
import { Sheet } from "./ui/Sheet";

/** Asked after "Reuse settings": keep the job's seed (same image again) or load everything but the seed. */
export function ReuseSeedPrompt() {
  const job = useReusePrompt((s) => s.job);
  const close = useReusePrompt((s) => s.close);
  return (
    <Sheet open={!!job} onClose={close} title="Reuse settings" height="60%">
      <p className="text-[14px] text-text-2">Use the same seed as this image?</p>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => job && applyReuse(job, true)}
          className="hover-wash flex h-11 items-center justify-center rounded-full bg-raised px-4 text-[14px] font-medium"
        >
          Same seed
        </button>
        <button
          type="button"
          onClick={() => job && applyReuse(job, false)}
          className="hover-wash flex h-11 items-center justify-center rounded-full border border-line-strong px-4 text-[14px] text-text-2 hover:text-text"
        >
          New seed
        </button>
      </div>
    </Sheet>
  );
}
