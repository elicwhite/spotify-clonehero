'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useGridWindow, useResponsiveColumns} from '../hooks/useGridWindow';

/** Estimated rendered height of one card row, including the grid gap (px). */
const ROW_HEIGHT = 280;

/**
 * Generic windowed (virtualized) card grid with keyboard navigation. Only the
 * rows in/around the viewport are mounted as DOM nodes, so the library stays
 * interactive with thousands of items. Owns its own scroll container; arrows
 * move focus across the grid and Enter activates the focused item. Shared by the
 * ungrouped fill grid and the grouped (cross-song dedupe) grid — both render
 * cards, only the card body differs, so the windowing + keyboard math lives here
 * once.
 */
export default function VirtualCardGrid<T>({
  items,
  getKey,
  renderCard,
  onActivate,
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
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useResponsiveColumns(scrollRef);
  const [rawFocus, setRawFocus] = useState<number | null>(null);

  const window = useGridWindow({
    scrollRef,
    itemCount: items.length,
    rowHeight: ROW_HEIGHT,
    columns,
  });

  const focusIndex = useMemo(
    () => (rawFocus != null && rawFocus < items.length ? rawFocus : null),
    [rawFocus, items.length],
  );

  useEffect(() => {
    if (focusIndex == null) return;
    const el = scrollRef.current;
    if (!el) return;
    const row = Math.floor(focusIndex / columns);
    const top = row * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTo({top});
    else if (bottom > el.scrollTop + el.clientHeight)
      el.scrollTo({top: bottom - el.clientHeight});
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

  const visible = items.slice(window.startIndex, window.endIndex);

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-rowcount={window.rowCount}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div style={{height: window.paddingTop}} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((item, i) => {
          const index = window.startIndex + i;
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
      <div style={{height: window.paddingBottom}} />
    </div>
  );
}
