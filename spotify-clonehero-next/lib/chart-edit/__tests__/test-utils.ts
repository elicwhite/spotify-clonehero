/**
 * Shared test helpers for chart-edit unit tests.
 *
 * Constructs ParsedTrackData entries with all fields the new ParsedChart shape
 * requires (noteEventGroups, animations, textEvents, versusPhrases,
 * unrecognizedMidiEvents, etc.) so tests can build documents synthetically.
 */

import type { ParsedTrackData, Instrument, Difficulty, NoteEvent, NoteType } from '../types';

/** Build a ParsedTrackData with all required fields zero-initialized. */
export function emptyTrackData(
  instrument: Instrument,
  difficulty: Difficulty,
  overrides: Partial<ParsedTrackData> = {},
): ParsedTrackData {
  return {
    instrument,
    difficulty,
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    trackEvents: [],
    textEvents: [],
    versusPhrases: [],
    animations: [],
    unrecognizedMidiEvents: [],
    noteEventGroups: [],
    ...overrides,
  } as ParsedTrackData;
}

/** Fill in msTime/msLength=0 on any section-shaped object. */
export function mkSection<T extends object>(fields: T): T & { msTime: number; msLength: number } {
  return { msTime: 0, msLength: 0, ...fields };
}

/** NoteEvent factory — fills msTime=0, msLength=length. */
export function mkNote(
  fields: { tick: number; length: number; type: number; flags: number },
): NoteEvent {
  return { msTime: 0, msLength: fields.length, ...fields, type: fields.type as NoteType };
}
