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

import {drumTypes} from './types';

// Re-export the scan-chart surface consumers depend on
export {createEmptyChart, writeChartFolder};

// Chart file format conversion (.chart <-> .mid) for export
export {writeChartFileAs} from './write-chart-file-as';
export type {WrittenChartFile} from './write-chart-file-as';

// The chart file and the `song.ini` beside it, from one serialization — what
// a host persists so the ini-only fields survive a reload
export {chartDocToFolderFiles} from './folder-files';
export type {ChartFolderFiles} from './folder-files';
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

// Timing primitives (plan 0061 §1/§2) — in-memory msTime/msLength recompute
// and format-quantized BPM, the push-model backing for the mutators above
export {
  retimeChart,
  makeChartTiming,
  applyEventTiming,
  quantizeBpm,
  type ChartTiming,
} from './retime';

// Audio-anchored tempo remap (plan 0061 §3 class (a)) — KEEP-MS primitive
// plus the sparse-marker BPM math and collision post-pass both glue ops share
export {
  synctrackFromChart,
  nudgeNoteCollisions,
  remapKeepMs,
  applyMarkerMoveBpms,
  MIN_SEGMENT_MS,
  type RemapKeepMsOptions,
} from './tempo-remap';

// Leading-silence padding (plan 0064) — audio anchor accessors, refresh
// helpers used by tempo commands, and the plan/apply pair the editor button
// drives
export {
  getAudioAnchor,
  setAudioAnchor,
  refreshAnchorKeepMs,
  refreshAnchorKeepTick,
  planLeadingSilence,
  applyLeadingSilence,
  LEAD_MIN_MS,
  COLLAPSE_BPM_MIN,
  type AudioAnchor,
  type LeadingSilencePlan,
} from './leading-silence';

// Denominator-aware bar/beat derivation (plan 0061 §3b) — the one shared
// implementation of timeSignatures ⇄ downbeats/bars for every view
export {
  beatUnitTicks,
  audioExtendedEndTick,
  deriveBeatGrid,
  deriveDownbeatFlags,
  deriveTimeSignatures,
  normalizeTimeSignatures,
  type TimeSignatureInput,
  type DerivedTimeSignature,
  type DownbeatEntry,
  type DownbeatFlags,
  type BeatGridEntry,
} from './bar-derivation';

// Downbeat-flag store operations (plan 0061 §3b/§6; 0062 §8) — per-beat
// mark/unmark and the whole-song phase-rotation tap gesture. No note retiming.
export {
  chartEndTick,
  snapTickToNearestBeat,
  markDownbeat,
  unmarkDownbeat,
  rephaseDownbeats,
} from './downbeat-ops';

// Placing a bar line at an arbitrary tick (plan 0082): the shared arithmetic
// behind "make this a downbeat", "insert a time signature change", and
// dragging a time-signature marker.
export {
  MAX_TS_DENOMINATOR,
  meterForGap,
  planDownbeatAt,
  planTimeSignatureMove,
  type DownbeatPlan,
  type DownbeatPlanOk,
  type DownbeatPlanNoop,
  type DownbeatPlanInexact,
  type Meter,
  type PlacedMeter,
} from './downbeat';

// Lyric helpers (vocal part lyrics)
export {
  DEFAULT_VOCALS_PART,
  lyricId,
  listLyricTicks,
  moveLyric,
  parseLyricId,
  addLyric,
  deleteLyric,
  restoreLyric,
  setLyricText,
  type RemovedLyric,
} from './helpers/lyrics';

// Vocal phrase helpers
export {
  phraseStartId,
  phraseEndId,
  listPhraseStartTicks,
  listPhraseEndTicks,
  movePhraseStart,
  movePhraseEnd,
  movePhrases,
  phraseTranslationBounds,
  type PhraseSpan,
  parsePhraseId,
  addPhrase,
  deletePhrase,
  insertPhrase,
} from './helpers/phrases';

// Per-entity-kind dispatch
export {
  entityHandlers,
  cloneDocFor,
  noteId,
  type EntityKind,
  type CommandEntityKind,
  type SelectableKind,
  type CommandOperation,
  type EntityRef,
  type EntityKindHandler,
  type EntityContext,
} from './entities';

// Schema-driven note adapter (plan 0037 Task 4) — lane/flag math and
// NoteEvent read/write generalized over any InstrumentSchema.
export {
  schemaNoteId,
  parseSchemaNoteId,
  typeToLane,
  laneToType,
  shiftLane,
  padLaneRange,
  fullLaneRange,
  laneRangeFor,
  type LaneAxis,
  defaultFlagBits,
  toggleFlagBits,
  legalizeFlagBits,
  listNotes,
  findNote,
  addNote,
  removeNote,
  setNoteFlags,
  setNoteLength,
  moveNote,
  moveNotes,
  type NoteRef,
} from './entities/notes';

// Generic active-track lookup (replaces findExpertDrumsTrack across the editor)
export {
  findTrack,
  findTrackInParsedChart,
  findTrackOnly,
  type TrackKey,
} from './find-track';

// Canonical empty-track shape (one list of scan-chart's event containers)
export {
  clearTrackContents,
  emptyTrack,
  emptyTrackContents,
} from './empty-track';

// Shared grid-snapping (one implementation for both interaction views)
export {snapTickToGrid, gridStepTicks, nextGridTick} from './snapping';

// Per-instrument display schemas (lane data, flag bindings, default keys)
export {
  drums4LaneSchema,
  drums5LaneSchema,
  drumSchemaFor,
  CYMBAL_LEGAL_NOTE_TYPES,
  isCymbalLegalNoteType,
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
 * consumer's intended interpretation rather than song.ini's — e.g.
 * `{pro_drums: true}` so tom/cymbal modifiers are honored from the very
 * first parse, not just on subsequent edit round-trips. Hosts that open a
 * chart for editing use {@link readChartForEditing} instead, which picks
 * that override from the chart itself.
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

  const {parsedChart} = result;

  return {
    parsedChart: iniChartModifiersOverride
      ? reparseWithModifiers(parsedChart, iniChartModifiersOverride)
      : parsedChart,
    assets,
  };
}

/**
 * Re-parse an already-parsed chart's own bytes with `override` merged into
 * its modifiers, so HOPO/cymbal/etc. derivation matches the override from the
 * start. `parseChartFile` returns the narrow shape (no
 * chartBytes/format/iniChartModifiers) so the wider `ParsedChart` consumers
 * expect is re-stitched here.
 *
 * `parseChartFile`'s own `metadata` only carries what the source FILE embeds
 * (the .chart file's `[Song]` section; nothing at all for .mid — see
 * scan-chart's `RawChartData.metadata` doc comment). It never sees song.ini.
 * The caller's first parse already did the ini-wins overlay onto
 * `parsedChart.metadata` — that's the metadata every consumer actually wants
 * (charter, artist, delay, etc.), so it is carried through explicitly rather
 * than replaced by the reparse's narrower one.
 */
function reparseWithModifiers(
  parsedChart: ChartDocument['parsedChart'],
  override: Partial<import('@eliwhite/scan-chart').IniChartModifiers>,
): ChartDocument['parsedChart'] {
  const iniMergedMetadata = parsedChart.metadata;
  const mergedModifiers = {
    ...parsedChart.iniChartModifiers,
    ...override,
  };
  const reparsed = parseChartFile(
    parsedChart.chartBytes,
    parsedChart.format,
    mergedModifiers,
  );
  return {
    ...reparsed,
    metadata: iniMergedMetadata,
    chartBytes: parsedChart.chartBytes,
    format: parsedChart.format,
    iniChartModifiers: mergedModifiers,
  };
}

/**
 * Parse a chart folder the way the chart editor edits it.
 *
 * Same as {@link readChart}, except a chart that parsed as basic four-lane
 * drums is re-parsed with pro-drums interpretation. The editor offers the
 * cymbal toggle on every four-lane drum track (`drumSchemaFor` gives
 * `fourLane` and `fourLanePro` the same schema), but the .chart writer only
 * emits a cymbal marker when the chart itself is pro-drums — so on a basic
 * four-lane chart a cymbal edit would be shown, saved, and silently lost on
 * the next read.
 *
 * Charts that already parsed as pro-drums or five-lane keep their own
 * `drumType`: forcing `pro_drums` outranks five-lane detection in scan-chart,
 * which would re-read a Guitar Hero five-lane chart as four-lane pro.
 */
export function readChartForEditing(files: File[]): ChartDocument {
  const doc = readChart(files);
  if (doc.parsedChart.drumType !== drumTypes.fourLane) return doc;
  return {
    ...doc,
    parsedChart: reparseWithModifiers(doc.parsedChart, {pro_drums: true}),
  };
}
