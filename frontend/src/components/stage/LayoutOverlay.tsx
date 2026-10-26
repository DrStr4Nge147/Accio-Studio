import { regionColor, type Region } from "../../features/create/builder/ideogram";

/** The boxes of a layout prompt drawn over the card (which has the image's proportions), so you can see them while it renders. */
export function LayoutOverlay({ regions }: { regions: Region[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
      {regions.map((r, i) => {
        const c = regionColor(r, i);
        return (
          <div key={r.id} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, borderColor: c, backgroundColor: `${c}14` }} className="absolute overflow-hidden border-2">
            <span style={{ backgroundColor: c }} className="absolute left-0 top-0 px-1 text-[10px] font-semibold leading-4 text-black">
              {String(i + 1).padStart(2, "0")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
