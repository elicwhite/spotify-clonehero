'use client';

import {useCallback} from 'react';
import type {FillWithSrs} from '@/lib/local-db/drum-fills';
import VirtualCardGrid from './VirtualCardGrid';
import FillCard from './FillCard';

/**
 * Ungrouped (one card per fill instance) virtualized library grid. The
 * windowing + keyboard navigation live in {@link VirtualCardGrid}; this only
 * supplies the per-fill card body and the attempt-stats annotation.
 */
export default function FillGrid({
  fills,
  attemptStats,
  onPracticeFill,
}: {
  fills: FillWithSrs[];
  attemptStats?: Map<string, {count: number; lastTs: number}>;
  onPracticeFill: (fillId: string) => void;
}) {
  const onActivate = useCallback(
    (index: number) => onPracticeFill(fills[index].id),
    [fills, onPracticeFill],
  );

  return (
    <VirtualCardGrid
      items={fills}
      getKey={f => f.id}
      onActivate={onActivate}
      renderCard={(fill, _index, {focused, onFocus}) => {
        const stats = attemptStats?.get(fill.id);
        return (
          <FillCard
            fill={fill}
            attemptCount={stats?.count}
            lastAttemptTs={stats?.lastTs}
            focused={focused}
            onFocus={onFocus}
            onPractice={onPracticeFill}
          />
        );
      }}
    />
  );
}
