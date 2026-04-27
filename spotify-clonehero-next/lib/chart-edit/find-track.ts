/**
 * findTrack — generic active-track lookup for the chart editor.
 *
 * Replaces the hard-coded `findExpertDrumsTrack(doc)` lookup that was
 * scattered across the editor and chart-edit. Phase 1 of the architecture
 * rewrite (`plans/in-progress/0030-editor-active-scope-instrument-schema.md`).
 */

import type {
  ChartDocument,
  Difficulty,
  Instrument,
  ParsedChart,
  ParsedTrackData,
} from './types';

export interface TrackKey {
  instrument: Instrument;
  difficulty: Difficulty;
}

/**
 * Resolve a `(instrument, difficulty)` pair to its `ParsedTrackData` slice
 * inside a `ParsedChart`. Returns null when no matching track exists.
 *
 * Use this when you only have a parsed chart in hand (e.g. during the
 * round-trip in `useEditCommands` after `parseChartFile`). When you have
 * a `ChartDocument`, prefer `findTrack`.
 */
export function findTrackInParsedChart(
  parsedChart: Pick<ParsedChart, 'trackData'>,
  key: TrackKey,
): {track: ParsedTrackData; index: number} | null {
  const tracks = parsedChart.trackData;
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.instrument === key.instrument && t.difficulty === key.difficulty) {
      return {track: t, index: i};
    }
  }
  return null;
}

/**
 * Resolve a `(instrument, difficulty)` pair to its `ParsedTrackData` slice
 * inside a `ChartDocument`. Returns null when no matching track exists.
 */
export function findTrack(
  doc: ChartDocument,
  key: TrackKey,
): {track: ParsedTrackData; index: number} | null {
  return findTrackInParsedChart(doc.parsedChart, key);
}

/** Convenience: pull just the track, dropping the index. */
export function findTrackOnly(
  doc: ChartDocument,
  key: TrackKey,
): ParsedTrackData | null {
  return findTrack(doc, key)?.track ?? null;
}
