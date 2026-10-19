'use client';

import {useCallback} from 'react';
import type {GroupedFill} from '@/lib/drum-fills/db';
import VirtualCardGrid from './VirtualCardGrid';
import GroupedFillCard from './GroupedFillCard';

/**
 * Grouped (one card per unique fill pattern, cross-song dedupe) virtualized
 * library grid. Practicing a group opens its representative instance. Reuses the
 * shared windowing + keyboard grid.
 */
export default function GroupedFillGrid({
  groups,
  onPracticeFill,
}: {
  groups: GroupedFill[];
  onPracticeFill: (fillId: string) => void;
}) {
  const onActivate = useCallback(
    (index: number) => onPracticeFill(groups[index].representative.id),
    [groups, onPracticeFill],
  );

  return (
    <VirtualCardGrid
      items={groups}
      getKey={g => g.fillSimilarityKey}
      onActivate={onActivate}
      renderCard={(group, _index, {focused, onFocus}) => (
        <GroupedFillCard
          group={group}
          focused={focused}
          onFocus={onFocus}
          onPractice={onPracticeFill}
        />
      )}
    />
  );
}
