import { lazy, Suspense } from "react";

const Gallery = lazy(() => import("./Gallery").then((m) => ({ default: m.Gallery })));

/** The gallery is its own chunk: it only loads when the Gallery tab is opened. */
export function LazyGallery() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center text-[13px] text-text-3">Loading…</div>}>
      <Gallery />
    </Suspense>
  );
}
