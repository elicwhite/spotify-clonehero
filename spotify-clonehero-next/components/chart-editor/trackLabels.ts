/**
 * Human-readable instrument and difficulty labels shared by every editor
 * surface that names a track: the Chart Matrix rows/cells and the highway
 * pane label chips.
 */

import type {Difficulty} from '@/lib/chart-edit';
import type {SupportedTrackInstrument} from '@/lib/chart-editor-core';

export const INSTRUMENT_LABEL: Record<SupportedTrackInstrument, string> = {
  guitar: 'Guitar',
  bass: 'Bass',
  drums: 'Drums',
};

export const DIFFICULTY_COLUMNS: {
  difficulty: Difficulty;
  label: string;
  name: string;
}[] = [
  {difficulty: 'expert', label: 'X', name: 'Expert'},
  {difficulty: 'hard', label: 'H', name: 'Hard'},
  {difficulty: 'medium', label: 'M', name: 'Medium'},
  {difficulty: 'easy', label: 'E', name: 'Easy'},
];

export function instrumentLabel(instrument: string): string {
  return INSTRUMENT_LABEL[instrument as SupportedTrackInstrument] ?? instrument;
}

export function difficultyName(difficulty: Difficulty): string {
  return (
    DIFFICULTY_COLUMNS.find(col => col.difficulty === difficulty)?.name ??
    difficulty
  );
}

/** `"Guitar · Expert"` — the highway pane chip and matrix tooltip form. */
export function trackLabel(track: {
  instrument: string;
  difficulty: Difficulty;
}): string {
  return `${instrumentLabel(track.instrument)} · ${difficultyName(track.difficulty)}`;
}
