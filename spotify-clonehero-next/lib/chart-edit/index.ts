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
  parseChartFile,
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
 * `iniChartModifiersOverride` merges into the modifiers used for the
 * parse itself, so derived fields (HOPO/cymbal/etc.) reflect the
 * consumer's intended interpretation rather than song.ini's. The
 * drum-edit page uses this with `{pro_drums: true}` so tom/cymbal
 * modifiers are honored from the very first parse, not just on
 * subsequent edit round-trips.
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

  let {parsedChart} = result;
  if (iniChartModifiersOverride) {
    // parseChartAndIni already parsed once with song.ini's modifiers; re-parse
    // the same bytes with the merged modifiers so HOPO/cymbal/etc. derivation
    // matches the override from the start. parseChartFile returns the narrow
    // shape (no chartBytes/format/iniChartModifiers) so we re-stitch the wider
    // ParsedChart that consumers expect.
    const mergedModifiers = {
      ...parsedChart.iniChartModifiers,
      ...iniChartModifiersOverride,
    };
    const reparsed = parseChartFile(
      parsedChart.chartBytes,
      parsedChart.format,
      mergedModifiers,
    );
    parsedChart = {
      ...reparsed,
      chartBytes: parsedChart.chartBytes,
      format: parsedChart.format,
      iniChartModifiers: mergedModifiers,
    };
  }

  return {parsedChart, assets};
}
