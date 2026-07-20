'use client';

import {useMemo} from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {useChartEditorContext} from './ChartEditorContext';
import {isTrackScope} from './scope';
import type {Difficulty, Instrument, ParsedTrackData} from '@/lib/chart-edit';

const DIFFICULTY_ORDER: Difficulty[] = ['expert', 'hard', 'medium', 'easy'];
const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  expert: 'Expert',
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
};

/**
 * Difficulties charted for `instrument` across `trackData`, in
 * expert-first display order. Pure function so the derivation is testable
 * without rendering the picker.
 */
export function computeAvailableDifficulties(
  trackData: ParsedTrackData[],
  instrument: Instrument,
): Difficulty[] {
  const present = new Set(
    trackData.filter(t => t.instrument === instrument).map(t => t.difficulty),
  );
  return DIFFICULTY_ORDER.filter(d => present.has(d));
}

/**
 * Header control that switches the active scope between difficulties of
 * the same instrument (e.g. guitar Expert/Hard/Medium/Easy). Renders only
 * when the active scope is a track scope and the chart has more than one
 * charted difficulty for that instrument — a single-difficulty chart has
 * nothing to pick between.
 */
export default function DifficultyPicker() {
  const {state, dispatch} = useChartEditorContext();
  const scope = state.activeScope;

  const available = useMemo(() => {
    if (!isTrackScope(scope) || !state.chartDoc) return [];
    return computeAvailableDifficulties(
      state.chartDoc.parsedChart.trackData,
      scope.track.instrument,
    );
  }, [scope, state.chartDoc]);

  if (!isTrackScope(scope) || available.length <= 1) return null;

  return (
    <Select
      value={scope.track.difficulty}
      onValueChange={value =>
        dispatch({
          type: 'SET_ACTIVE_SCOPE',
          scope: {
            kind: 'track',
            track: {
              instrument: scope.track.instrument,
              difficulty: value as Difficulty,
            },
          },
        })
      }>
      <SelectTrigger className="h-8 w-[7.5rem] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {available.map(d => (
          <SelectItem key={d} value={d}>
            {DIFFICULTY_LABELS[d]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
