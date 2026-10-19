/**
 * Shared test helpers for chart-edit unit tests.
 *
 * Track construction goes through `emptyTrack`, the same canonical empty
 * shape production code builds from, so a scan-chart schema change can never
 * leave the fixtures describing a track shape nothing else produces.
 */

import type {
  ParsedTrackData,
  Instrument,
  Difficulty,
  NoteEvent,
  NoteType,
} from '../types';
import {emptyTrack} from '../empty-track';

/** Build a ParsedTrackData with all required fields zero-initialized. */
export function emptyTrackData(
  instrument: Instrument,
  difficulty: Difficulty,
  overrides: Partial<ParsedTrackData> = {},
): ParsedTrackData {
  return {...emptyTrack({instrument, difficulty}), ...overrides};
}

/** Fill in msTime/msLength=0 on any section-shaped object. */
export function mkSection<T extends object>(
  fields: T,
): T & {msTime: number; msLength: number} {
  return {msTime: 0, msLength: 0, ...fields};
}

/** NoteEvent factory — fills msTime=0, msLength=length. */
export function mkNote(fields: {
  tick: number;
  length: number;
  type: number;
  flags: number;
}): NoteEvent {
  return {
    msTime: 0,
    msLength: fields.length,
    ...fields,
    type: fields.type as NoteType,
  };
}
