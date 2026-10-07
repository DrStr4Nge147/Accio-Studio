/** Fixed-cell grid maths for the virtualized gallery: only the rows near the viewport are rendered. */
export interface GridLayout {
  cols: number;
  /** Cell edge in px (cells are square). */
  cell: number;
  gap: number;
  rows: number;
  rowHeight: number;
  totalHeight: number;
}

export function gridLayout(width: number, count: number, minCell = 150, gap = 6): GridLayout {
  const usable = Math.max(0, width);
  const cols = Math.max(1, Math.floor((usable + gap) / (minCell + gap)));
  const cell = Math.max(1, (usable - gap * (cols - 1)) / cols);
  const rows = Math.ceil(count / cols);
  const rowHeight = cell + gap;
  return { cols, cell, gap, rows, rowHeight, totalHeight: rows ? rows * rowHeight - gap : 0 };
}

/** Item index range [first, last) to render for the current scroll position, with `overscan` extra rows each side. */
export function visibleRange(layout: GridLayout, scrollTop: number, viewportHeight: number, count: number, overscan = 2) {
  if (!count) return { first: 0, last: 0 };
  const firstRow = Math.max(0, Math.floor(scrollTop / layout.rowHeight) - overscan);
  const lastRow = Math.min(layout.rows - 1, Math.floor((scrollTop + viewportHeight) / layout.rowHeight) + overscan);
  return { first: firstRow * layout.cols, last: Math.min(count, (lastRow + 1) * layout.cols) };
}

export function itemPosition(layout: GridLayout, index: number) {
  return { x: (index % layout.cols) * (layout.cell + layout.gap), y: Math.floor(index / layout.cols) * layout.rowHeight };
}

/** True when the viewport is within `rowsAhead` rows of the end of the list, so the next page should load. */
export function nearEnd(layout: GridLayout, scrollTop: number, viewportHeight: number, rowsAhead = 3) {
  return scrollTop + viewportHeight >= layout.totalHeight - rowsAhead * layout.rowHeight;
}
