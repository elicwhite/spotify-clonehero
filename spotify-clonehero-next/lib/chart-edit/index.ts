/**
 * chart-edit public API
 *
 * Thin wrapper around `@eliwhite/scan-chart`:
 *  - `readChart(files)` — `parseChartAndIni` with asset classification
 *  - `writeChartFolder`, `createEmptyChart` — re-exported directly
 *  - drum/section/tempo helpers — local, operate on normalized `ParsedChart` data
 */

import {
  parseChartAndIni,
  createEmptyChart,
  writeChartFolder,
} from '@eliwhite/scan-chart';
import type {ChartDocument, File} from '@eliwhite/scan-chart';

// Re-export the scan-chart surface consumers depend on
export {createEmptyChart, writeChartFolder};
export type {
  ChartDocument,
  File,
  ParsedChart,
  ParsedTrackData,
  IniChartModifiers,
  RawChartData,
  EventType,
  Instrument,
  Difficulty,
  NoteEvent,
  NoteType,
  NormalizedVocalTrack,
  NormalizedVocalPart,
  NormalizedVocalPhrase,
  NormalizedLyricEvent,
  NormalizedVocalNote,
  DrumType,
  VocalTrackData,
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
} from './types';

// Constants
export {
  eventTypes,
  instruments,
  difficulties,
  noteTypes,
  noteFlags,
  lyricFlags,
  drumTypes,
  drumNoteTypeMap,
  noteTypeToDrumNote,
} from './types';

// Drum helpers
export {
  addDrumNote,
  removeDrumNote,
  getDrumNotes,
  setDrumNoteFlags,
} from './helpers/drum-notes';

// Drum section helpers (star power, activation lanes, solos, flex lanes)
export {
  addStarPower,
  removeStarPower,
  addActivationLane,
  removeActivationLane,
  addSoloSection,
  removeSoloSection,
  addFlexLane,
  removeFlexLane,
} from './helpers/drum-sections';

// Tempo / time signature helpers
export {
  addTempo,
  removeTempo,
  addTimeSignature,
  removeTimeSignature,
} from './helpers/tempo';

// Named section (globalEvent) helpers
export {addSection, removeSection} from './helpers/sections';

// Lyric helpers (vocal part lyrics)
export {
  DEFAULT_VOCALS_PART,
  lyricId,
  listLyricTicks,
  moveLyric,
  parseLyricId,
} from './helpers/lyrics';

// Vocal phrase helpers
export {
  phraseStartId,
  phraseEndId,
  listPhraseStartTicks,
  listPhraseEndTicks,
  movePhraseStart,
  movePhraseEnd,
  parsePhraseId,
} from './helpers/phrases';

// Per-entity-kind dispatch
export {
  entityHandlers,
  cloneDocFor,
  noteId,
  type EntityKind,
  type EntityRef,
  type EntityKindHandler,
  type EntityContext,
} from './entities';

// Generic active-track lookup (replaces findExpertDrumsTrack across the editor)
export {
  findTrack,
  findTrackInParsedChart,
  findTrackOnly,
  type TrackKey,
} from './find-track';

// Per-instrument display schemas (lane data, flag bindings, default keys)
export {
  drums4LaneSchema,
  drums5LaneSchema,
  drumSchemaFor,
  bassSchema,
  guitarSchema,
  keysSchema,
  rhythmSchema,
  laneAt,
  laneForNoteType,
  schemaForInstrument,
  schemaForTrack,
  type InstrumentSchema,
  type LaneDefinition,
  type FlagBinding,
  type NoteFlagName,
} from './instruments';

// ---------------------------------------------------------------------------
// readChart — parses a chart folder into a ChartDocument
// ---------------------------------------------------------------------------

/**
 * Parse a chart folder (notes.chart / notes.mid + song.ini + passthrough
 * assets) into a scan-chart `ChartDocument`. Throws if the chart file can't
 * be found or parsed.
 *
 * `iniChartModifiersOverride` merges into the parsed chart's
 * `iniChartModifiers` so callers can force interpretation that song.ini
 * (or scan-chart's defaults) wouldn't otherwise produce. The drum-edit
 * page uses this with `{pro_drums: true}` so tom/cymbal modifiers stay
 * meaningful through edit / re-parse cycles.
 */
export function readChart(
  files: File[],
  iniChartModifiersOverride?: Partial<
    import('@eliwhite/scan-chart').IniChartModifiers
  >,
): ChartDocument {
  const result = parseChartAndIni(files);
  if (!result.parsedChart) {
    const reason =
      result.chartFolderIssues[0]?.description ?? 'Could not parse chart';
    throw new Error(reason);
  }
  const chartFileNames = new Set(['notes.chart', 'notes.mid', 'song.ini']);
  const assets = files.filter(
    f => !chartFileNames.has(f.fileName.toLowerCase()),
  );
  const parsedChart = iniChartModifiersOverride
    ? {
        ...result.parsedChart,
        iniChartModifiers: {
          ...result.parsedChart.iniChartModifiers,
          ...iniChartModifiersOverride,
        },
      }
    : result.parsedChart;
  return {parsedChart, assets};
}
