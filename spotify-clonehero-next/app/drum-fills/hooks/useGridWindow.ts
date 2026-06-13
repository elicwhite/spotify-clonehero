'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {
  computeGridWindow,
  type GridWindow,
} from '@/lib/drum-fills/library/gridWindow';

/**
 * React wrapper around the pure {@link computeGridWindow} math. Tracks the
 * scroll container's scrollTop and viewport height (via a passed ref) and the
 * responsive column count (measured from the container width), and returns the
 * current visible-item window. Scroll updates run through requestAnimationFrame
 * so they don't thrash React state on every scroll event.
 */
export function useGridWindow({
  scrollRef,
  itemCount,
  rowHeight,
  columns,
  overscanRows = 2,
}: {
  scrollRef: React.RefObject<HTMLElement | null>;
  itemCount: number;
  rowHeight: number;
  columns: number;
  overscanRows?: number;
}): GridWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const rafRef = useRef<number | null>(null);

  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    sync();

    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, {passive: true});

    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [scrollRef, sync]);

  return computeGridWindow({
    itemCount,
    columns,
    rowHeight,
    scrollTop,
    viewportHeight,
    overscanRows,
  });
}

/**
 * Responsive column count matching the library grid's Tailwind breakpoints
 * (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`). Measured from a
 * container element's width so the windowing math knows items-per-row.
 */
export function useResponsiveColumns(
  ref: React.RefObject<HTMLElement | null>,
): number {
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      // Tailwind defaults: sm 640, lg 1024, xl 1280.
      const next = w >= 1280 ? 4 : w >= 1024 ? 3 : w >= 640 ? 2 : 1;
      setColumns(prev => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return columns;
}
