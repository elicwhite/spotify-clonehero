/**
 * Cross-format validation test suite.
 *
 * Walks a directory of real Clone Hero charts (controlled by CHART_DIR env var),
 * reads each one, converts to the OTHER format, re-parses with scan-chart, and
 * deep-compares the result. Any difference is a bug in our writer/reader code.
 *
 * Usage:
 *   CHART_DIR=~/Desktop/enchor-songs\ copy npx jest --testPathPattern=real-charts --no-coverage
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { readChart } from '../reader';
import { writeChart } from '../writer';
import {
  parseNotesFromChart,
  parseNotesFromMidi,
  defaultIniChartModifiers,
} from '@eliwhite/scan-chart';
import type { RawChartData, IniChartModifiers } from '@eliwhite/scan-chart';
import type { FileEntry, ChartMetadata } from '../types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CHART_DIR = process.env.CHART_DIR;
const CHART_LIMIT = process.env.CHART_LIMIT
  ? parseInt(process.env.CHART_LIMIT, 10)
  : undefined;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Diff {
  field: string;
  message: string;
  details?: string;
}

interface FailureRecord {
  path: string;
  originalFormat: 'chart' | 'mid';
  convertedFormat: 'chart' | 'mid';
  diffs: Diff[];
}

interface Report {
  timestamp: string;
  chartDir: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: FailureRecord[];
}

// ---------------------------------------------------------------------------
// Directory walking
// ---------------------------------------------------------------------------

/** Recursively find chart folders (folders containing notes.chart or notes.mid). */
function findChartFolders(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    const hasChart = entries.some(
      (e) => e === 'notes.chart' || e === 'notes.mid',
    );
    if (hasChart) {
      results.push(current);
      return; // Don't recurse into chart folders
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          walk(fullPath);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  walk(dir);
  return results.sort();
}

/** Load all files in a chart folder as FileEntry[]. */
function loadChartFolder(folderPath: string): FileEntry[] {
  const entries = readdirSync(folderPath);
  const files: FileEntry[] = [];

  for (const entry of entries) {
    const fullPath = join(folderPath, entry);
    try {
      if (statSync(fullPath).isFile()) {
        // Only load chart-relevant files (skip large audio/image files)
        const lower = entry.toLowerCase();
        if (
          lower === 'notes.chart' ||
          lower === 'notes.mid' ||
          lower === 'song.ini'
        ) {
          files.push({
            fileName: entry,
            data: readFileSync(fullPath),
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// IniChartModifiers from metadata (mirrors reader.ts buildIniChartModifiers)
// ---------------------------------------------------------------------------

function buildModifiers(metadata: ChartMetadata): IniChartModifiers {
  return {
    ...defaultIniChartModifiers,
    hopo_frequency:
      metadata.hopo_frequency ?? defaultIniChartModifiers.hopo_frequency,
    eighthnote_hopo:
      metadata.eighthnote_hopo ?? defaultIniChartModifiers.eighthnote_hopo,
    multiplier_note:
      metadata.multiplier_note ?? defaultIniChartModifiers.multiplier_note,
    sustain_cutoff_threshold:
      metadata.sustain_cutoff_threshold ??
      defaultIniChartModifiers.sustain_cutoff_threshold,
    chord_snap_threshold:
      metadata.chord_snap_threshold ??
      defaultIniChartModifiers.chord_snap_threshold,
    five_lane_drums:
      metadata.five_lane_drums ?? defaultIniChartModifiers.five_lane_drums,
    pro_drums: metadata.pro_drums ?? defaultIniChartModifiers.pro_drums,
    song_length:
      metadata.song_length ?? defaultIniChartModifiers.song_length,
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

import { eventTypes } from '../types';

type TrackDataEntry = RawChartData['trackData'][number];
type TrackEventEntry = TrackDataEntry['trackEvents'][number];

/**
 * Event types that are format-specific markers for cymbal/tom distinction.
 * .chart uses cymbal markers (36-38), MIDI uses tom markers (33-35).
 * Cross-format conversion is tested separately in cross-format.test.ts,
 * so we strip these here for a fair comparison.
 */
const CYMBAL_TOM_MARKER_TYPES = new Set<number>([
  eventTypes.yellowTomMarker,   // 33
  eventTypes.blueTomMarker,     // 34
  eventTypes.greenTomMarker,    // 35
  eventTypes.yellowCymbalMarker, // 36
  eventTypes.blueCymbalMarker,  // 37
  eventTypes.greenCymbalMarker, // 38
]);

/**
 * Disco flip events are format-specific toggle events.
 * .chart uses discoFlipOff/On/discoNoFlipOn, MIDI uses a different encoding.
 */
const DISCO_FLIP_TYPES = new Set<number>([
  eventTypes.discoFlipOff,      // 51
  eventTypes.discoFlipOn,       // 52
  eventTypes.discoNoFlipOn,     // 53
]);

/**
 * Guitar-only force modifiers. These can appear in drum tracks in some MIDI
 * files (e.g., note 104 → forceTap) but are not meaningful for drums and
 * won't survive cross-format conversion.
 */
const GUITAR_MODIFIER_TYPES = new Set<number>([
  eventTypes.forceOpen,         // 27 (.mid only)
  eventTypes.forceTap,          // 28
  eventTypes.forceStrum,        // 29 (.mid only)
  eventTypes.forceHopo,         // 30 (.mid only)
  eventTypes.forceUnnatural,    // 31 (.chart only)
]);

/**
 * The enableChartDynamics event is a MIDI-only meta-track text event.
 * It's auto-generated by the MIDI writer when accents/ghosts are present.
 */
const META_ONLY_TYPES = new Set<number>([
  eventTypes.enableChartDynamics, // 54
]);

/**
 * Structural event types that are extracted into dedicated arrays
 * (starPowerSections, soloSections) and should not appear in trackEvents
 * comparison. scan-chart's .chart parser may emit soloSectionStart/End
 * as trackEvents rather than extracting them into soloSections (unlike
 * the MIDI parser which puts note 103 directly into soloSections).
 */
const STRUCTURAL_EVENT_TYPES = new Set<number>([
  eventTypes.starPower,         // 0
  eventTypes.soloSection,       // 1
  eventTypes.rejectedStarPower, // 2
  eventTypes.soloSectionStart,  // 3 (.chart only)
  eventTypes.soloSectionEnd,    // 4 (.chart only)
  eventTypes.flexLaneSingle,    // 24
  eventTypes.flexLaneDouble,    // 25
  eventTypes.freestyleSection,  // 26
]);

/**
 * Accent and ghost modifier events are stored differently between formats:
 * - .chart: separate trackEvents with distinct types (kickAccent=50, etc.)
 * - MIDI: encoded as velocity on the base note (127=accent, 1=ghost)
 *
 * The MIDI raw parser produces accent/ghost events when ENABLE_CHART_DYNAMICS
 * is present, but not all charts have this flag. Filter from comparison since
 * accent/ghost round-trip is tested separately in the unit tests.
 */
const ACCENT_GHOST_TYPES = new Set<number>([
  eventTypes.redAccent,                 // 45
  eventTypes.yellowAccent,              // 46
  eventTypes.blueAccent,                // 47
  eventTypes.fiveOrangeFourGreenAccent, // 48
  eventTypes.fiveGreenAccent,           // 49
  eventTypes.kickAccent,                // 50
  eventTypes.redGhost,                  // 39
  eventTypes.yellowGhost,               // 40
  eventTypes.blueGhost,                 // 41
  eventTypes.fiveOrangeFourGreenGhost,  // 42
  eventTypes.fiveGreenGhost,            // 43
  eventTypes.kickGhost,                 // 44
]);

function sortByTick<T extends { tick: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.tick - b.tick);
}

/**
 * Normalize a single track event for comparison:
 * - Strip format-specific fields (velocity, channel)
 * - Normalize drum note lengths to 0 (drums don't sustain;
 *   .chart stores 0 while MIDI produces real noteOn→noteOff lengths)
 */
function normalizeEvent(e: TrackEventEntry): { tick: number; type: number; length: number } {
  return {
    tick: e.tick,
    type: e.type,
    // Drum notes don't sustain — normalize length to 0
    length: 0,
  };
}

function sortAndFilterTrackEvents(
  events: TrackEventEntry[],
  difficulty?: string,
): Array<{ tick: number; type: number; length: number }> {
  return events
    .filter((e) => {
      if (CYMBAL_TOM_MARKER_TYPES.has(e.type)) return false;
      if (DISCO_FLIP_TYPES.has(e.type)) return false;
      if (META_ONLY_TYPES.has(e.type)) return false;
      if (GUITAR_MODIFIER_TYPES.has(e.type)) return false;
      if (STRUCTURAL_EVENT_TYPES.has(e.type)) return false;
      if (ACCENT_GHOST_TYPES.has(e.type)) return false;
      // kick2x (Expert+) is note 95 in MIDI, which is Expert-only.
      // .chart allows kick2x per-difficulty, but MIDI can't represent it
      // on non-expert. Filter kick2x from non-expert comparisons.
      if (e.type === eventTypes.kick2x && difficulty !== 'expert') return false;
      return true;
    })
    .map(normalizeEvent)
    .sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      return a.type - b.type;
    });
}

/**
 * Normalize a section-like array: strip extra fields, keep only tick + length.
 * Lengths are clamped to a minimum of 1 because .chart can store zero-length
 * S events, but MIDI requires at least length 1 for noteOn/noteOff pairs.
 */
function normalizeSections<T extends { tick: number; length: number }>(
  arr: T[],
): Array<{ tick: number; length: number }> {
  return sortByTick(arr).map((s) => ({
    tick: s.tick,
    length: Math.max(s.length, 1),
  }));
}

/**
 * Normalize BPM through the MIDI representation (the lossy bottleneck).
 *
 * Both formats must survive BPM → μs/beat (integer) → BPM → millibeats
 * (integer) → BPM. Normalizing through this full round-trip ensures both
 * sides of a cross-format comparison produce identical values.
 */
function normalizeBpm(bpm: number): number {
  const microsecondsPerBeat = Math.round(60000000 / bpm);
  return Math.round((60000000 / microsecondsPerBeat) * 1000) / 1000;
}

/**
 * Extract soloSections from trackEvents when the dedicated array is empty.
 *
 * scan-chart's .chart parser emits E "solo"/"soloend" as trackEvents with
 * types soloSectionStart (3) and soloSectionEnd (4), but does NOT populate
 * the soloSections array. The MIDI parser puts note 103 directly into
 * soloSections. This function unifies the representation.
 */
function extractSoloSections(
  track: TrackDataEntry,
): Array<{ tick: number; length: number }> {
  if (track.soloSections.length > 0) {
    return normalizeSections(track.soloSections);
  }

  // Extract from trackEvents
  const starts: number[] = [];
  const ends: number[] = [];
  for (const ev of track.trackEvents) {
    if (ev.type === eventTypes.soloSectionStart) starts.push(ev.tick);
    if (ev.type === eventTypes.soloSectionEnd) ends.push(ev.tick);
  }
  starts.sort((a, b) => a - b);
  ends.sort((a, b) => a - b);

  const sections: Array<{ tick: number; length: number }> = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    sections.push({ tick: starts[i], length: ends[i] - starts[i] });
  }
  return sections;
}

/**
 * Deduplicate an array of {tick, length} by key "tick:length".
 */
function deduplicateSections(
  arr: Array<{ tick: number; length: number }>,
): Array<{ tick: number; length: number }> {
  const seen = new Set<string>();
  return arr.filter((s) => {
    const key = `${s.tick}:${s.length}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type NormalizedData = {
  chartTicksPerBeat: number;
  tempos: Array<{ tick: number; beatsPerMinute: number }>;
  timeSignatures: Array<{ tick: number; numerator: number; denominator: number }>;
  sections: Array<{ tick: number; name: string }>;
  endEvents: Array<{ tick: number }>;
  // Per-difficulty: trackEvents only (notes are per-difficulty)
  trackData: Array<{
    instrument: string;
    difficulty: string;
    trackEvents: Array<{ tick: number; type: number; length: number }>;
  }>;
  // Instrument-wide: star power, freestyle, flex lanes are shared across
  // difficulties in MIDI but per-difficulty in .chart. We merge and
  // deduplicate across all difficulties for a fair cross-format comparison.
  starPowerSections: Array<{ tick: number; length: number }>;
  soloSections: Array<{ tick: number; length: number }>;
  drumFreestyleSections: Array<{ tick: number; length: number; isCoda: boolean }>;
  flexLanes: Array<{ tick: number; length: number; isDouble: boolean }>;
  lyrics: Array<{ tick: number; text: string }>;
  vocalPhrases: Array<{ tick: number; length: number }>;
};

/** Strip and sort RawChartData for stable comparison. */
function normalizeForComparison(raw: RawChartData): NormalizedData {
  const drumTracks = raw.trackData.filter((t) => t.instrument === 'drums');

  // Per-difficulty: only trackEvents (notes are per-difficulty)
  const trackData = drumTracks
    .map((t) => ({
      instrument: t.instrument,
      difficulty: t.difficulty,
      trackEvents: sortAndFilterTrackEvents(t.trackEvents, t.difficulty),
    }))
    .sort((a, b) => {
      const order = ['expert', 'hard', 'medium', 'easy'];
      return order.indexOf(a.difficulty) - order.indexOf(b.difficulty);
    });

  // Instrument-wide: merge across all difficulties and deduplicate
  const allSP = deduplicateSections(
    normalizeSections(drumTracks.flatMap((t) => t.starPowerSections)),
  );
  const allSolo = deduplicateSections(
    normalizeSections(drumTracks.flatMap((t) => extractSoloSections(t))),
  );
  // Freestyle sections: include isCoda flag, dedup by tick:length:isCoda
  const seenFS = new Set<string>();
  const allFS = sortByTick(drumTracks.flatMap((t) => t.drumFreestyleSections))
    .map((fs) => ({ tick: fs.tick, length: Math.max(fs.length, 1), isCoda: fs.isCoda }))
    .filter((fs) => {
      const key = `${fs.tick}:${fs.length}:${fs.isCoda}`;
      if (seenFS.has(key)) return false;
      seenFS.add(key);
      return true;
    });

  // Flex lanes: merge and deduplicate by tick:length:isDouble
  // Normalize length to min 1 (same as other sections — .chart allows
  // zero-length S events, MIDI requires noteOn/noteOff with length ≥ 1)
  const seenFlex = new Set<string>();
  const allFlex = sortByTick(drumTracks.flatMap((t) => t.flexLanes))
    .map((f) => ({ tick: f.tick, length: Math.max(f.length, 1), isDouble: f.isDouble }))
    .filter((f) => {
      const key = `${f.tick}:${f.length}:${f.isDouble}`;
      if (seenFlex.has(key)) return false;
      seenFlex.add(key);
      return true;
    });

  return {
    chartTicksPerBeat: raw.chartTicksPerBeat,
    tempos: sortByTick(raw.tempos).map((t) => ({
      tick: t.tick,
      beatsPerMinute: normalizeBpm(t.beatsPerMinute),
    })),
    timeSignatures: sortByTick(raw.timeSignatures).map((t) => ({
      tick: t.tick,
      numerator: t.numerator,
      denominator: t.denominator,
    })),
    sections: sortByTick(raw.sections).map((s) => ({
      tick: s.tick,
      name: s.name,
    })),
    endEvents: sortByTick(raw.endEvents).map((e) => ({ tick: e.tick })),
    trackData,
    starPowerSections: allSP,
    soloSections: allSolo,
    drumFreestyleSections: allFS,
    flexLanes: allFlex,
    // Deduplicate lyrics by tick+text (the .chart writer's dedup removes
    // identical events at the same tick). Filter empty-text lyrics (used as
    // timing placeholders in some MIDI files but discarded by the .chart parser).
    lyrics: (() => {
      const seen = new Set<string>();
      return sortByTick(raw.lyrics)
        .map((l) => ({ tick: l.tick, text: l.text.trim() }))
        .filter((l) => {
          if (l.text === '') return false;
          const key = `${l.tick}:${l.text}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    })(),
    // MIDI has both note 105 (Player 1) and note 106 (Player 2) phrase markers.
    // scan-chart merges both into vocalPhrases. Notes 105 and 106 at the same
    // tick may have different lengths. Our writer only writes note 105.
    // Deduplicate by tick, keeping the longest length at each tick.
    // Apply same dedup + overlap-trim as the writer so both sides match.
    vocalPhrases: (() => {
      const byTick = new Map<number, number>();
      for (const p of raw.vocalPhrases) {
        const len = Math.max(p.length, 1);
        const existing = byTick.get(p.tick);
        if (existing === undefined || len > existing) {
          byTick.set(p.tick, len);
        }
      }
      const sorted = [...byTick.entries()]
        .map(([tick, length]) => ({ tick, length }))
        .sort((a, b) => a.tick - b.tick);
      // Trim overlapping phrases (same logic as writer)
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].tick - sorted[i].tick;
        if (sorted[i].length > gap) sorted[i].length = gap;
      }
      return sorted;
    })(),
  };
}

// ---------------------------------------------------------------------------
// Deep comparison
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keysA = Object.keys(aObj).sort();
    const keysB = Object.keys(bObj).sort();
    if (!deepEqual(keysA, keysB)) return false;
    return keysA.every((k) => deepEqual(aObj[k], bObj[k]));
  }

  return false;
}

function compareNormalized(
  a: NormalizedData,
  b: NormalizedData,
): Diff[] {
  const diffs: Diff[] = [];

  // Top-level scalar
  if (a.chartTicksPerBeat !== b.chartTicksPerBeat) {
    diffs.push({
      field: 'chartTicksPerBeat',
      message: `Expected ${a.chartTicksPerBeat}, got ${b.chartTicksPerBeat}`,
    });
  }

  // Top-level arrays
  for (const field of ['tempos', 'timeSignatures', 'sections', 'endEvents'] as const) {
    if (!deepEqual(a[field], b[field])) {
      diffs.push({
        field,
        message: `Expected ${a[field].length} entries, got ${b[field].length}`,
        details: JSON.stringify(
          { expected: a[field], actual: b[field] },
          null,
          2,
        ).slice(0, 2000),
      });
    }
  }

  // Lyrics and vocal phrases
  for (const field of ['lyrics', 'vocalPhrases'] as const) {
    if (!deepEqual(a[field], b[field])) {
      diffs.push({
        field,
        message: `Expected ${a[field].length} entries, got ${b[field].length}`,
        details: JSON.stringify(
          { expected: a[field].slice(0, 10), actual: b[field].slice(0, 10) },
          null,
          2,
        ).slice(0, 2000),
      });
    }
  }

  // Instrument-wide sections (merged across difficulties)
  for (const field of ['starPowerSections', 'soloSections', 'drumFreestyleSections', 'flexLanes'] as const) {
    if (!deepEqual(a[field], b[field])) {
      diffs.push({
        field,
        message: `Expected ${a[field].length} entries, got ${b[field].length}`,
        details: JSON.stringify(
          { expected: a[field], actual: b[field] },
          null,
          2,
        ).slice(0, 2000),
      });
    }
  }

  // Per-difficulty track data (notes only)
  // Only compare difficulties present in both sides (empty difficulties
  // in .chart may not be recreated after MIDI round-trip).
  const bDiffs = new Set(b.trackData.map((t) => t.difficulty));
  const commonTracks = a.trackData.filter((t) => bDiffs.has(t.difficulty));
  const bByDiff = new Map(b.trackData.map((t) => [t.difficulty, t]));

  for (const ta of commonTracks) {
    const tb = bByDiff.get(ta.difficulty)!;
    const prefix = `trackData(${ta.difficulty})`;

    if (!deepEqual(ta.trackEvents, tb.trackEvents)) {
      const maxLen = Math.max(ta.trackEvents.length, tb.trackEvents.length);
      let firstDiffIdx = -1;
      for (let j = 0; j < maxLen; j++) {
        if (!deepEqual(ta.trackEvents[j], tb.trackEvents[j])) {
          firstDiffIdx = j;
          break;
        }
      }
      diffs.push({
        field: `${prefix}.trackEvents`,
        message: `Expected ${ta.trackEvents.length} events, got ${tb.trackEvents.length}. First diff at index ${firstDiffIdx}`,
        details: JSON.stringify(
          {
            expectedAt: firstDiffIdx >= 0 ? ta.trackEvents[firstDiffIdx] : null,
            actualAt: firstDiffIdx >= 0 ? tb.trackEvents[firstDiffIdx] : null,
            expectedTotal: ta.trackEvents.length,
            actualTotal: tb.trackEvents.length,
          },
          null,
          2,
        ),
      });
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Per-chart validation
// ---------------------------------------------------------------------------

/**
 * Validate a single chart folder: read → convert to other format → re-parse → compare.
 * Returns null on success, a FailureRecord on diff, or 'skip' if not applicable.
 */
function validateChart(
  folder: string,
  chartDir: string,
): FailureRecord | 'skip' | null {
  const relPath = relative(chartDir, folder);
  const files = loadChartFolder(folder);

  let doc;
  try {
    doc = readChart(files);
  } catch {
    return 'skip';
  }

  if (!doc.trackData.some((t) => t.instrument === 'drums')) {
    return 'skip';
  }

  const chartFile = files.find(
    (f) => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  )!;
  const isChart = chartFile.fileName === 'notes.chart';

  let rawA: RawChartData;
  try {
    rawA = isChart
      ? parseNotesFromChart(chartFile.data)
      : parseNotesFromMidi(chartFile.data, buildModifiers(doc.metadata));
  } catch {
    return 'skip';
  }

  const originalFormat = doc.originalFormat;
  const convertedFormat = originalFormat === 'chart' ? 'mid' : 'chart';
  doc.originalFormat = convertedFormat;

  let output: FileEntry[];
  try {
    output = writeChart(doc);
  } catch (err) {
    return {
      path: relPath,
      originalFormat,
      convertedFormat,
      diffs: [{ field: 'writeChart', message: `Write failed: ${(err as Error).message}` }],
    };
  }

  const convertedFile = output.find(
    (f) => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  )!;

  let rawB: RawChartData;
  try {
    rawB = convertedFormat === 'chart'
      ? parseNotesFromChart(convertedFile.data)
      : parseNotesFromMidi(convertedFile.data, buildModifiers(doc.metadata));
  } catch (err) {
    return {
      path: relPath,
      originalFormat,
      convertedFormat,
      diffs: [{ field: 'parse', message: `Parse of converted file failed: ${(err as Error).message}` }],
    };
  }

  const diffs = compareNormalized(
    normalizeForComparison(rawA),
    normalizeForComparison(rawB),
  );

  return diffs.length === 0 ? null : { path: relPath, originalFormat, convertedFormat, diffs };
}

// ---------------------------------------------------------------------------
// Strict same-format normalization (all instruments, minimal filtering)
// ---------------------------------------------------------------------------

type StrictNormalizedTrack = {
  instrument: string;
  difficulty: string;
  trackEvents: Array<{ tick: number; type: number; length: number }>;
  starPowerSections: Array<{ tick: number; length: number }>;
  soloSections: Array<{ tick: number; length: number }>;
  drumFreestyleSections: Array<{ tick: number; length: number; isCoda: boolean }>;
  flexLanes: Array<{ tick: number; length: number; isDouble: boolean }>;
};

type StrictNormalizedData = {
  chartTicksPerBeat: number;
  tempos: Array<{ tick: number; beatsPerMinute: number }>;
  timeSignatures: Array<{ tick: number; numerator: number; denominator: number }>;
  sections: Array<{ tick: number; name: string }>;
  endEvents: Array<{ tick: number }>;
  trackData: StrictNormalizedTrack[];
  lyrics: Array<{ tick: number; text: string }>;
  vocalPhrases: Array<{ tick: number; length: number }>;
};

/**
 * Strict normalization for same-format roundtrip.
 * Includes ALL instruments (not just drums) and ALL event types.
 * Only strips velocity/channel fields that scan-chart's raw parsers
 * add inconsistently between formats.
 */
function normalizeStrict(raw: RawChartData, format?: 'chart' | 'mid'): StrictNormalizedData {
  const trackData = raw.trackData
    .map((t) => {
      // For trackEvents: strip velocity/channel, keep everything else.
      // Only filter STRUCTURAL types (already in dedicated arrays).
      // Filter orphaned accent/ghost modifiers (no base note at same tick) —
      // scan-chart produces these from overlapping modifier sustains, but
      // they can't roundtrip through MIDI (ghost/accent = velocity on base note).
      // Clamp lengths to min 1 for MIDI (our writer uses Math.max(length, 1)
      // to avoid noteOff sorting issues with zero-length notes).
      const events = t.trackEvents
        .filter((e) => !STRUCTURAL_EVENT_TYPES.has(e.type))
        .map((e) => ({ tick: e.tick, type: e.type, length: Math.max(e.length, 1) }))
        .sort((a, b) => a.tick !== b.tick ? a.tick - b.tick : a.type - b.type);

      return {
        instrument: t.instrument,
        difficulty: t.difficulty,
        trackEvents: events,
        starPowerSections: normalizeSections(t.starPowerSections),
        soloSections: extractSoloSections(t),
        drumFreestyleSections: sortByTick(t.drumFreestyleSections)
          .map((fs) => ({ tick: fs.tick, length: Math.max(fs.length, 1), isCoda: fs.isCoda })),
        flexLanes: sortByTick(t.flexLanes)
          .map((f) => ({ tick: f.tick, length: Math.max(f.length, 1), isDouble: f.isDouble })),
      };
    })
    .sort((a, b) => {
      if (a.instrument !== b.instrument) return a.instrument.localeCompare(b.instrument);
      const order = ['expert', 'hard', 'medium', 'easy'];
      return order.indexOf(a.difficulty) - order.indexOf(b.difficulty);
    });

  return {
    chartTicksPerBeat: raw.chartTicksPerBeat,
    tempos: sortByTick(raw.tempos).map((t) => ({
      tick: t.tick,
      beatsPerMinute: t.beatsPerMinute,
    })),
    timeSignatures: sortByTick(raw.timeSignatures).map((t) => ({
      tick: t.tick,
      numerator: t.numerator,
      denominator: t.denominator,
    })),
    sections: sortByTick(raw.sections).map((s) => ({ tick: s.tick, name: s.name })),
    endEvents: sortByTick(raw.endEvents).map((e) => ({ tick: e.tick })),
    trackData,
    lyrics: sortByTick(raw.lyrics).map((l) => ({
      tick: l.tick,
      text: l.text,
    })),
    // vocalPhrases: dedup by tick (keep longest) + overlap-trim.
    // This normalization matches what our writer does: dedup note 105/106
    // by tick and trim overlapping phrases. Both sides apply the same
    // transformation, so the comparison is fair.
    vocalPhrases: (() => {
      const byTick = new Map<number, number>();
      for (const p of raw.vocalPhrases) {
        const len = Math.max(p.length, 1);
        const existing = byTick.get(p.tick);
        if (existing === undefined || len > existing) {
          byTick.set(p.tick, len);
        }
      }
      const sorted = [...byTick.entries()]
        .map(([tick, length]) => ({ tick, length }))
        .sort((a, b) => a.tick - b.tick);
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].tick - sorted[i].tick;
        if (sorted[i].length > gap) sorted[i].length = gap;
      }
      return sorted;
    })(),
  };
}

function compareStrict(a: StrictNormalizedData, b: StrictNormalizedData): Diff[] {
  const diffs: Diff[] = [];

  if (a.chartTicksPerBeat !== b.chartTicksPerBeat) {
    diffs.push({ field: 'chartTicksPerBeat', message: `${a.chartTicksPerBeat} vs ${b.chartTicksPerBeat}` });
  }

  for (const field of ['tempos', 'timeSignatures', 'sections', 'endEvents', 'lyrics', 'vocalPhrases'] as const) {
    if (!deepEqual(a[field], b[field])) {
      diffs.push({
        field,
        message: `Expected ${a[field].length} entries, got ${b[field].length}`,
        details: JSON.stringify({ expected: a[field].slice(0, 5), actual: b[field].slice(0, 5) }, null, 2).slice(0, 2000),
      });
    }
  }

  // Compare track data: match by instrument+difficulty
  const bTrackMap = new Map(b.trackData.map((t) => [`${t.instrument}:${t.difficulty}`, t]));
  const aTrackMap = new Map(a.trackData.map((t) => [`${t.instrument}:${t.difficulty}`, t]));

  // Tracks in A but not B
  for (const [key, ta] of aTrackMap) {
    if (!bTrackMap.has(key) && ta.trackEvents.length > 0) {
      diffs.push({ field: `track(${key})`, message: `Missing in output (had ${ta.trackEvents.length} events)` });
    }
  }

  // Compare matching tracks
  for (const [key, ta] of aTrackMap) {
    const tb = bTrackMap.get(key);
    if (!tb) continue;

    for (const section of ['trackEvents', 'starPowerSections', 'soloSections', 'drumFreestyleSections', 'flexLanes'] as const) {
      if (!deepEqual(ta[section], tb[section])) {
        const aArr = ta[section] as unknown[];
        const bArr = tb[section] as unknown[];
        let firstDiffIdx = -1;
        for (let j = 0; j < Math.max(aArr.length, bArr.length); j++) {
          if (!deepEqual(aArr[j], bArr[j])) { firstDiffIdx = j; break; }
        }
        diffs.push({
          field: `track(${key}).${section}`,
          message: `Expected ${aArr.length}, got ${bArr.length}. First diff at ${firstDiffIdx}`,
          details: JSON.stringify({
            expectedAt: firstDiffIdx >= 0 ? aArr[firstDiffIdx] : null,
            actualAt: firstDiffIdx >= 0 ? bArr[firstDiffIdx] : null,
          }, null, 2),
        });
      }
    }
  }

  return diffs;
}

/**
 * Same-format roundtrip: read → write (same format) → re-parse → compare.
 * Uses strict normalization with ALL instruments and ALL event types.
 */
function validateSameFormatRoundtrip(
  folder: string,
  chartDir: string,
): FailureRecord | 'skip' | null {
  const relPath = relative(chartDir, folder);
  const files = loadChartFolder(folder);

  let doc;
  try {
    doc = readChart(files);
  } catch {
    return 'skip';
  }

  if (doc.trackData.length === 0) {
    return 'skip';
  }

  const chartFile = files.find(
    (f) => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  )!;
  const isChart = chartFile.fileName === 'notes.chart';
  const format = doc.originalFormat;

  let rawA: RawChartData;
  try {
    rawA = isChart
      ? parseNotesFromChart(chartFile.data)
      : parseNotesFromMidi(chartFile.data, buildModifiers(doc.metadata));
  } catch {
    return 'skip';
  }

  let output: FileEntry[];
  try {
    output = writeChart(doc);
  } catch (err) {
    return {
      path: relPath,
      originalFormat: format,
      convertedFormat: format,
      diffs: [{ field: 'writeChart', message: `Write failed: ${(err as Error).message}` }],
    };
  }

  const outputFile = output.find(
    (f) => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  )!;

  let rawB: RawChartData;
  try {
    rawB = isChart
      ? parseNotesFromChart(outputFile.data)
      : parseNotesFromMidi(outputFile.data, buildModifiers(doc.metadata));
  } catch (err) {
    return {
      path: relPath,
      originalFormat: format,
      convertedFormat: format,
      diffs: [{ field: 'parse', message: `Re-parse failed: ${(err as Error).message}` }],
    };
  }

  const diffs = compareStrict(normalizeStrict(rawA, format), normalizeStrict(rawB, format));
  return diffs.length === 0 ? null : { path: relPath, originalFormat: format, convertedFormat: format, diffs };
}

// ---------------------------------------------------------------------------
// Main test suite — one it() per chart for Jest sharding
// ---------------------------------------------------------------------------

if (!CHART_DIR) {
  // Placeholder so the suite isn't empty when CHART_DIR is unset (e.g. CI)
  it('skipped — CHART_DIR not set', () => {});
}

// Early-exit: the rest of the file requires CHART_DIR
if (!CHART_DIR) {
  // Already registered the placeholder test above
} else {

const chartDir = CHART_DIR.replace(/^~/, process.env.HOME || '~');

if (!existsSync(chartDir)) {
  throw new Error(`CHART_DIR does not exist: ${chartDir}`);
}

let folders = findChartFolders(chartDir);
if (CHART_LIMIT && CHART_LIMIT < folders.length) {
  folders = folders.slice(0, CHART_LIMIT);
}

describe('real-chart cross-format validation', () => {

  const report: Report = {
    timestamp: new Date().toISOString(),
    chartDir,
    total: folders.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  afterAll(() => {
    const reportPath = join(__dirname, 'real-charts-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

    console.log('\n=== Real Charts Report ===');
    console.log(`Total:   ${report.total}`);
    console.log(`Passed:  ${report.passed}`);
    console.log(`Failed:  ${report.failed}`);
    console.log(`Skipped: ${report.skipped}`);
    if (report.failures.length > 0) {
      console.log('\nFailures:');
      for (const f of report.failures) {
        console.log(`  ${f.path} (${f.originalFormat} → ${f.convertedFormat})`);
        for (const d of f.diffs) {
          console.log(`    ${d.field}: ${d.message}`);
        }
      }
    }
    console.log(`\nReport written to: ${reportPath}`);
  });

  // One test per chart folder for per-chart failure output and filtering
  it.each(folders.map((folder) => [relative(chartDir, folder), folder]))(
    '%s',
    (_relPath, folder) => {
      const result = validateChart(folder as string, chartDir);
      if (result === 'skip') {
        report.skipped++;
        return;
      }
      if (result === null) {
        report.passed++;
        return;
      }
      report.failed++;
      report.failures.push(result);
      const summary = result.diffs.map((d) => `${d.field}: ${d.message}`).join('; ');
      fail(`${result.path} (${result.originalFormat}→${result.convertedFormat}): ${summary}`);
    },
  );
});

describe('real-chart same-format roundtrip', () => {
  const roundtripReport: Report = {
    timestamp: new Date().toISOString(),
    chartDir,
    total: folders.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  afterAll(() => {
    const reportPath = join(__dirname, 'real-charts-roundtrip-report.json');
    writeFileSync(reportPath, JSON.stringify(roundtripReport, null, 2) + '\n');

    console.log('\n=== Same-Format Roundtrip Report ===');
    console.log(`Total:   ${roundtripReport.total}`);
    console.log(`Passed:  ${roundtripReport.passed}`);
    console.log(`Failed:  ${roundtripReport.failed}`);
    console.log(`Skipped: ${roundtripReport.skipped}`);
    if (roundtripReport.failures.length > 0) {
      console.log('\nFailures:');
      for (const f of roundtripReport.failures) {
        console.log(`  ${f.path} (${f.originalFormat} → ${f.convertedFormat})`);
        for (const d of f.diffs) {
          console.log(`    ${d.field}: ${d.message}`);
        }
      }
    }
    console.log(`\nReport written to: ${reportPath}`);
  });

  it.each(folders.map((folder) => [relative(chartDir, folder), folder]))(
    'roundtrip %s',
    (_relPath, folder) => {
      const result = validateSameFormatRoundtrip(folder as string, chartDir);
      if (result === 'skip') {
        roundtripReport.skipped++;
        return;
      }
      if (result === null) {
        roundtripReport.passed++;
        return;
      }
      roundtripReport.failed++;
      roundtripReport.failures.push(result);
      const summary = result.diffs.map((d) => `${d.field}: ${d.message}`).join('; ');
      fail(`${result.path} (${result.originalFormat}→${result.convertedFormat}): ${summary}`);
    },
  );
});

} // end if (CHART_DIR)
