'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useVirtual} from 'react-virtual';
import {useResponsiveColumns} from '../hooks/useResponsiveColumns';

/** Initial per-row height estimate (incl. grid gap); rows self-measure after. */
const DEFAULT_ROW_HEIGHT = 280;

/** One grid row; columns match `useResponsiveColumns`'s breakpoints. `pb-4`
 * supplies the vertical gap so each measured row includes it. */
const ROW_CLASS =
  'grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/**
 * Generic windowed (virtualized) card grid with keyboard navigation, backed by
 * `react-virtual`. Only the rows in/around the viewport are mounted, so the grid
 * stays interactive with thousands of items; rows self-measure (the `rowHeight`
 * prop is just the initial estimate). Owns its own scroll container; arrows move
 * focus and Enter activates the focused item. Shared by the fill grids and the
 * grooves grid — only the card body differs.
 */
export default function VirtualCardGrid<T>({
  items,
  getKey,
  renderCard,
  onActivate,
  rowHeight = DEFAULT_ROW_HEIGHT,
}: {
  items: T[];
  getKey: (item: T) => string;
  /** Render one card. `focused`/`onFocus` wire the grid's keyboard focus. */
  renderCard: (
    item: T,
    index: number,
    opts: {focused: boolean; onFocus: () => void},
  ) => React.ReactNode;
  /** Activate the item at `index` (Enter on a focused card). */
  onActivate: (index: number) => void;
  /** Initial row-height estimate; rows self-measure. Defaults to 280. */
  rowHeight?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useResponsiveColumns(scrollRef);
  const [rawFocus, setRawFocus] = useState<number | null>(null);

  const rowCount = Math.ceil(items.length / columns);

  const rowVirtualizer = useVirtual({
    size: rowCount,
    parentRef: scrollRef,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 3,
  });

  const focusIndex = useMemo(
    () => (rawFocus != null && rawFocus < items.length ? rawFocus : null),
    [rawFocus, items.length],
  );

  // Keep the latest `scrollToIndex` in a ref (the virtualizer returns a new
  // callback each render) so the scroll-into-view effect can fire only when the
  // focused row changes, rather than every render where it would fight the
  // user's own scrolling. The ref is written in an effect, never during render.
  const scrollToIndexRef = useRef(rowVirtualizer.scrollToIndex);
  useEffect(() => {
    scrollToIndexRef.current = rowVirtualizer.scrollToIndex;
  });
  useEffect(() => {
    if (focusIndex == null) return;
    scrollToIndexRef.current(Math.floor(focusIndex / columns));
  }, [focusIndex, columns]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (items.length === 0) return;
      const cur = focusIndex ?? 0;
      let next: number | null = null;
      switch (e.key) {
        case 'ArrowRight':
          next = Math.min(items.length - 1, cur + 1);
          break;
        case 'ArrowLeft':
          next = Math.max(0, cur - 1);
          break;
        case 'ArrowDown':
          next = Math.min(items.length - 1, cur + columns);
          break;
        case 'ArrowUp':
          next = Math.max(0, cur - columns);
          break;
        case 'Enter':
          if (focusIndex != null) {
            e.preventDefault();
            onActivate(focusIndex);
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      setRawFocus(focusIndex == null ? 0 : next);
    },
    [items.length, focusIndex, columns, onActivate],
  );

  const {virtualItems, totalSize} = rowVirtualizer;
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-rowcount={rowCount}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div style={{height: paddingTop}} />
      {virtualItems.map(virtualRow => {
        const start = virtualRow.index * columns;
        const rowItems = items.slice(start, start + columns);
        return (
          <div
            key={virtualRow.key}
            ref={virtualRow.measureRef}
            className={ROW_CLASS}>
            {rowItems.map((item, c) => {
              const index = start + c;
              return (
                <span key={getKey(item)} className="contents">
                  {renderCard(item, index, {
                    focused: index === focusIndex,
                    onFocus: () => setRawFocus(index),
                  })}
                </span>
              );
            })}
          </div>
        );
      })}
      <div style={{height: paddingBottom}} />
    </div>
  );
}
