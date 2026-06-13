'use client';

import {useEffect, useState} from 'react';

/**
 * Responsive column count matching the card grid's Tailwind breakpoints
 * (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`). Measured from a
 * container element's width so the virtualized grid knows items-per-row.
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
