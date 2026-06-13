/**
 * Pure windowing math for a fixed-row-height, uniform-cell grid (the library
 * fill grid). Given the scroll position and viewport height it computes which
 * rows are visible and the spacer heights above/below them, so the UI only
 * mounts the cards in (and just around) the viewport instead of all ~7,800.
 *
 * Layout assumption: a CSS grid with `columns` equal-width cells per row, each
 * row `rowHeight` tall including the `gap` between rows. The math is unit-tested
 * in isolation; the React wrapper (`useGridWindow`) just feeds it live numbers.
 */

export interface GridWindowParams {
  /** Total number of items in the grid. */
  itemCount: number;
  /** Items per row (responsive column count). Clamped to >= 1. */
  columns: number;
  /** Height of one row in px, INCLUDING the row gap below it. Must be > 0. */
  rowHeight: number;
  /** Current scroll offset of the scroll container, in px. */
  scrollTop: number;
  /** Visible height of the scroll container, in px. */
  viewportHeight: number;
  /**
   * Extra rows to render above and below the viewport so fast scrolls don't
   * flash empty space. Defaults to 2.
   */
  overscanRows?: number;
}

export interface GridWindow {
  /** Index of the first item to render (inclusive). */
  startIndex: number;
  /** Index just past the last item to render (exclusive). */
  endIndex: number;
  /** Spacer height (px) before the rendered items. */
  paddingTop: number;
  /** Spacer height (px) after the rendered items. */
  paddingBottom: number;
  /** Total scrollable content height (px) for all rows. */
  totalHeight: number;
  /** Total number of rows in the grid. */
  rowCount: number;
}

/** Compute the visible item window + spacer heights for a uniform grid. */
export function computeGridWindow(params: GridWindowParams): GridWindow {
  const columns = Math.max(1, Math.floor(params.columns));
  const rowHeight = params.rowHeight > 0 ? params.rowHeight : 1;
  const overscan = Math.max(0, params.overscanRows ?? 2);
  const itemCount = Math.max(0, params.itemCount);

  const rowCount = Math.ceil(itemCount / columns);
  const totalHeight = rowCount * rowHeight;

  if (itemCount === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0,
      rowCount: 0,
    };
  }

  const scrollTop = Math.max(0, params.scrollTop);
  const viewportHeight = Math.max(0, params.viewportHeight);

  const firstVisibleRow = Math.floor(scrollTop / rowHeight);
  const lastVisibleRow = Math.floor((scrollTop + viewportHeight) / rowHeight);

  const startRow = Math.max(0, firstVisibleRow - overscan);
  // +1 so the partially-visible last row is included, then overscan.
  const endRow = Math.min(rowCount, lastVisibleRow + 1 + overscan);

  const startIndex = startRow * columns;
  const endIndex = Math.min(itemCount, endRow * columns);

  const paddingTop = startRow * rowHeight;
  const paddingBottom = Math.max(0, (rowCount - endRow) * rowHeight);

  return {
    startIndex,
    endIndex,
    paddingTop,
    paddingBottom,
    totalHeight,
    rowCount,
  };
}
