/** Gesture decisions for the gallery viewer, kept pure so they can be tested. */

export const DRAG_START_PX = 10;
export const TAP_MAX_PX = 8;
export const TAP_MAX_MS = 350;
export const FLING_PX_PER_MS = 0.45;
export const GAP_PX = 12; // space between neighbouring slides of the carousel

/** True when a press has turned into a horizontal drag of the carousel (not a tap, not a vertical or diagonal move). */
export const isDragStart = (dx: number, dy: number) => Math.abs(dx) > DRAG_START_PX && Math.abs(dx) > Math.abs(dy) * 1.2;

/**
 * Where a released drag ends up: +1 = the next (older) image, -1 = the previous (newer), 0 = snap back. Past a third of
 * the width, or a quick flick, commits; an end of the list never does.
 */
export function dragOutcome(dx: number, width: number, velocity: number, hasPrev: boolean, hasNext: boolean): -1 | 0 | 1 {
  const forward = dx < 0; // dragging left reveals the next image on the right
  if (forward ? !hasNext : !hasPrev) return 0;
  const far = Math.abs(dx) > width / 3;
  const flick = Math.abs(velocity) > FLING_PX_PER_MS && Math.abs(dx) > 24;
  return far || flick ? (forward ? 1 : -1) : 0;
}

/** Drag distance with resistance when there is nothing to reveal on that side (rubber band). */
export const resist = (dx: number, hasPrev: boolean, hasNext: boolean) => ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext) ? dx * 0.3 : dx);

export const isTap = (dx: number, dy: number, ms: number) => Math.hypot(dx, dy) <= TAP_MAX_PX && ms <= TAP_MAX_MS;

/** The id `step` places away from `id` in the list, or null at either end (or when `id` is not in the list). */
export function neighborId<T extends { id: string }>(items: T[], id: string, step: number): string | null {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  return items[i + step]?.id ?? null;
}

/** Where to look after the shown item disappeared (deleted): the item that took its place, else the last one, else none. */
export function afterRemoval<T extends { id: string }>(items: T[], lastIndex: number): string | null {
  if (!items.length) return null;
  return items[Math.min(Math.max(lastIndex, 0), items.length - 1)]!.id;
}
