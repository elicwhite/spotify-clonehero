/**
 * The difficulty-generation routes, and the instrument each one works on.
 *
 * Both directions live here so the page that stamps a project and the editor
 * that opens it cannot disagree: `/drum-difficulties` writes
 * `'drum-difficulties'`, and the editor reads that back to know it should
 * open on drums.
 */

import type {SupportedTrackInstrument} from '@/lib/chart-editor-core';
import type {ProjectOrigin} from './types';

/** Which origin a difficulty route stamps its projects with. */
export const DIFFICULTY_ORIGIN = {
  drums: 'drum-difficulties',
  guitar: 'guitar-difficulties',
} as const satisfies Partial<Record<SupportedTrackInstrument, ProjectOrigin>>;

/**
 * The instrument a difficulty-generated project was generated for, or null
 * for a project from anywhere else.
 */
export function difficultyInstrumentOf(
  origin: ProjectOrigin | undefined,
): SupportedTrackInstrument | null {
  const instruments = Object.keys(
    DIFFICULTY_ORIGIN,
  ) as (keyof typeof DIFFICULTY_ORIGIN)[];
  for (const instrument of instruments) {
    if (DIFFICULTY_ORIGIN[instrument] === origin) return instrument;
  }
  return null;
}
