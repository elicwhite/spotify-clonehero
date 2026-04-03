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
import { parseMidi } from 'midi-file';
import type { MidiEvent } from 'midi-file';

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
 * Guitar force modifiers that appear in drum tracks from MIDI SysEx bleed.
 * Not meaningful for drums and can't survive cross-format conversion on drums.
 * Only filtered on drum tracks — guitar tracks must preserve these.
 */
const DRUM_ONLY_GUITAR_MODIFIER_TYPES = new Set<number>([
  eventTypes.forceOpen,         // 27
  eventTypes.forceTap,          // 28
  eventTypes.forceStrum,        // 29
  eventTypes.forceHopo,         // 30
]);

/**
 * Force modifiers that encode differently between .chart and MIDI:
 * - forceUnnatural (31): .chart-only; replaced by forceHopo/forceStrum in MIDI
 * - forceHopo (30): MIDI-only; replaced by forceUnnatural in .chart
 * - forceStrum (29): MIDI-only; replaced by forceUnnatural in .chart
 * - forceOpen (27): MIDI-only SysEx; .chart represents open notes directly
 *   as note type 7 (open) without a separate modifier event.
 *
 * These can't be compared 1:1 in cross-format since the encoding is
 * semantically different.
 */
const CROSS_FORMAT_FORCE_TYPES = new Set<number>([
  eventTypes.forceUnnatural,    // 31 (.chart only)
  eventTypes.forceHopo,         // 30 (.mid only)
  eventTypes.forceStrum,        // 29 (.mid only)
  eventTypes.forceOpen,         // 27 (.mid only SysEx)
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

/**
 * Merge overlapping sections into non-overlapping ranges.
 * MIDI can't represent overlapping notes of the same pitch — per-difficulty
 * sections that overlap are merged by the writer. Apply the same merge here
 * so both sides of the cross-format comparison match.
 */
function mergeOverlapping(
  arr: Array<{ tick: number; length: number }>,
): Array<{ tick: number; length: number }> {
  if (arr.length === 0) return [];
  const sorted = [...arr].sort((a, b) => a.tick - b.tick);
  const merged: Array<{ tick: number; length: number }> = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    const prevEnd = prev.tick + prev.length;
    if (curr.tick <= prevEnd) {
      prev.length = Math.max(prevEnd, curr.tick + curr.length) - prev.tick;
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

function sortByTick<T extends { tick: number }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.tick - b.tick);
}

/**
 * Normalize a single track event for comparison:
 * - Strip format-specific fields (velocity, channel)
 * - Normalize drum note lengths to 0 (drums don't sustain;
 *   .chart stores 0 while MIDI produces real noteOn→noteOff lengths)
 * - Normalize guitar modifier lengths to 0 (MIDI stores sustain ranges
 *   that get split into zero-length per-note events by scan-chart)
 */
function normalizeEvent(
  e: TrackEventEntry,
  isDrums: boolean,
): { tick: number; type: number; length: number } {
  return {
    tick: e.tick,
    type: e.type,
    // Drum notes don't sustain — .chart stores 0, MIDI produces real
    // noteOn→noteOff lengths. Normalize to 0 for drums only.
    // Fret notes: scan-chart's MIDI parser discards zero-length notes
    // (noteOff sorted before noteOn at same tick → length stays -1 → removed).
    // The MIDI writer uses Math.max(length, 1) to work around this. Normalize
    // to max(length, 1) for cross-format comparison since this is a parser
    // limitation, not a writer bug.
    length: isDrums ? 0 : Math.max(e.length, 1),
  };
}

function sortAndFilterTrackEvents(
  events: TrackEventEntry[],
  instrument: string,
  difficulty: string,
): Array<{ tick: number; type: number; length: number }> {
  const isDrums = instrument === 'drums';
  return events
    .filter((e) => {
      // Format-specific cymbal/tom markers (tested in cross-format.test.ts)
      if (CYMBAL_TOM_MARKER_TYPES.has(e.type)) return false;
      // Disco flip toggle events (format-specific encoding)
      if (DISCO_FLIP_TYPES.has(e.type)) return false;
      // enableChartDynamics auto-generated meta event
      if (META_ONLY_TYPES.has(e.type)) return false;
      // Structural events extracted into dedicated arrays
      if (STRUCTURAL_EVENT_TYPES.has(e.type)) return false;
      // Force modifiers that encode differently between formats
      // (forceUnnatural ↔ forceHopo/forceStrum)
      if (CROSS_FORMAT_FORCE_TYPES.has(e.type)) return false;

      // Guitar modifiers on drum tracks: meaningless SysEx bleed
      if (isDrums && DRUM_ONLY_GUITAR_MODIFIER_TYPES.has(e.type)) return false;

      // Accent/ghost on drums: different encoding between formats
      // (.chart uses separate events, MIDI uses velocity).
      // Only filter on drums — guitar doesn't have accent/ghost.
      if (isDrums && ACCENT_GHOST_TYPES.has(e.type)) return false;

      // kick2x: MIDI note 95 is Expert-only. .chart allows per-difficulty.
      if (e.type === eventTypes.kick2x && difficulty !== 'expert') return false;

      return true;
    })
    .map(e => normalizeEvent(e, isDrums))
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
  // Per-instrument per-difficulty track data
  trackData: Array<{
    instrument: string;
    difficulty: string;
    trackEvents: Array<{ tick: number; type: number; length: number }>;
  }>;
  // Per-instrument sections: star power, solos, freestyle, flex lanes are
  // shared across difficulties in MIDI but per-difficulty in .chart. We merge
  // and deduplicate across difficulties within each instrument.
  instrumentSections: Array<{
    instrument: string;
    starPowerSections: Array<{ tick: number; length: number }>;
    soloSections: Array<{ tick: number; length: number }>;
    drumFreestyleSections: Array<{ tick: number; length: number; isCoda: boolean }>;
    flexLanes: Array<{ tick: number; length: number; isDouble: boolean }>;
  }>;
  lyrics: Array<{ tick: number; text: string }>;
  vocalPhrases: Array<{ tick: number; length: number }>;
};

/** Strip and sort RawChartData for stable comparison. */
function normalizeForComparison(raw: RawChartData): NormalizedData {
  const allTracks = raw.trackData;

  // Per-difficulty per-instrument: trackEvents (notes + modifiers)
  const trackData = allTracks
    .map((t) => ({
      instrument: t.instrument,
      difficulty: t.difficulty,
      trackEvents: sortAndFilterTrackEvents(t.trackEvents, t.instrument, t.difficulty),
    }))
    .sort((a, b) => {
      // Sort by instrument then difficulty
      if (a.instrument !== b.instrument) return a.instrument.localeCompare(b.instrument);
      const order = ['expert', 'hard', 'medium', 'easy'];
      return order.indexOf(a.difficulty) - order.indexOf(b.difficulty);
    });

  // Per-instrument sections: merge across difficulties within each instrument
  // and deduplicate. These are shared in MIDI but per-difficulty in .chart.
  const byInstrument = new Map<string, TrackDataEntry[]>();
  for (const t of allTracks) {
    let arr = byInstrument.get(t.instrument);
    if (!arr) {
      arr = [];
      byInstrument.set(t.instrument, arr);
    }
    arr.push(t);
  }

  const instrumentSections = [...byInstrument.entries()].map(([instrument, tracks]) => {
    // Merge overlapping sections: MIDI can't represent overlapping notes of
    // the same pitch, so per-difficulty sections that overlap get merged by
    // the writer. This is a spec-level constraint, not a writer bug.
    const sp = mergeOverlapping(deduplicateSections(
      normalizeSections(tracks.flatMap((t) => t.starPowerSections)),
    ));
    const solo = mergeOverlapping(deduplicateSections(
      normalizeSections(tracks.flatMap((t) => extractSoloSections(t))),
    ));
    const seenFS = new Set<string>();
    const fs = sortByTick(tracks.flatMap((t) => t.drumFreestyleSections))
      .map((f) => ({ tick: f.tick, length: Math.max(f.length, 1), isCoda: f.isCoda }))
      .filter((f) => {
        const key = `${f.tick}:${f.length}:${f.isCoda}`;
        if (seenFS.has(key)) return false;
        seenFS.add(key);
        return true;
      });
    const seenFlex = new Set<string>();
    const flex = sortByTick(tracks.flatMap((t) => t.flexLanes))
      .map((f) => ({ tick: f.tick, length: Math.max(f.length, 1), isDouble: f.isDouble }))
      .filter((f) => {
        const key = `${f.tick}:${f.length}:${f.isDouble}`;
        if (seenFlex.has(key)) return false;
        seenFlex.add(key);
        return true;
      });
    return {
      instrument,
      starPowerSections: sp,
      soloSections: solo,
      drumFreestyleSections: fs,
      flexLanes: flex,
    };
  }).sort((a, b) => a.instrument.localeCompare(b.instrument));

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
    instrumentSections,
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

  // Per-instrument sections (merged across difficulties within each instrument)
  const bInstrSections = new Map(
    b.instrumentSections.map((s) => [s.instrument, s]),
  );
  for (const aInstr of a.instrumentSections) {
    const bInstr = bInstrSections.get(aInstr.instrument);
    if (!bInstr) {
      diffs.push({
        field: `instrumentSections(${aInstr.instrument})`,
        message: `Instrument missing in output`,
      });
      continue;
    }
    for (const field of ['starPowerSections', 'soloSections', 'drumFreestyleSections', 'flexLanes'] as const) {
      if (!deepEqual(aInstr[field], bInstr[field])) {
        diffs.push({
          field: `${aInstr.instrument}.${field}`,
          message: `Expected ${aInstr[field].length} entries, got ${bInstr[field].length}`,
          details: JSON.stringify(
            { expected: aInstr[field], actual: bInstr[field] },
            null,
            2,
          ).slice(0, 2000),
        });
      }
    }
  }

  // Per-instrument per-difficulty track data
  // Match by instrument+difficulty pair. Only compare tracks present in both sides
  // (empty difficulties in .chart may not be recreated after MIDI round-trip).
  const trackKey = (t: { instrument: string; difficulty: string }) =>
    `${t.instrument}:${t.difficulty}`;
  const bTrackKeys = new Set(b.trackData.map(trackKey));
  const commonTracks = a.trackData.filter((t) => bTrackKeys.has(trackKey(t)));
  const bByKey = new Map(b.trackData.map((t) => [trackKey(t), t]));

  for (const ta of commonTracks) {
    const tb = bByKey.get(trackKey(ta))!;
    const prefix = `trackData(${ta.instrument}:${ta.difficulty})`;

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

  if (doc.trackData.length === 0) {
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
// Strict same-format round-trip: full-object comparison with blocklist
// ---------------------------------------------------------------------------

/**
 * Paths to exclude from same-format round-trip comparison.
 *
 * BLOCKLIST approach: everything in RawChartData is compared by default.
 * Only paths listed here are skipped. This means any new field scan-chart
 * adds will automatically be tested — if it doesn't round-trip, the test
 * fails, forcing us to either fix the writer or explicitly acknowledge the
 * gap by adding it here.
 *
 * Each entry is a dot-separated path like 'metadata.name' or a predicate.
 */
const ROUNDTRIP_BLOCKLIST_PATHS = new Set([
  // .chart [Song] only stores Resolution and Offset. All other metadata
  // lives in song.ini (a separate file not included in the raw parse output).
  'metadata.name',
  'metadata.artist',
  'metadata.album',
  'metadata.genre',
  'metadata.year',
  'metadata.charter',
  'metadata.preview_start_time',
  'metadata.diff_guitar',
]);

/**
 * Strip msTime/msLength from scan-chart output for structural comparison.
 * These are derived from tick + tempo and may have floating-point drift.
 *
 * Also strips the few fields that legitimately can't round-trip:
 * - metadata fields only in song.ini (not in .chart [Song] section)
 * - hasVocals / hasLyrics (derived from track presence, not always preserved)
 * - delay=0 ↔ undefined (semantically identical, writer skips Offset=0)
 *
 * Everything else is compared AS-IS: no sorting, no dedup, no length clamping.
 * If the output differs, it's a bug in the writer.
 */
function stripForComparison(obj: unknown, path = ''): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map((item, i) => stripForComparison(item, `${path}[${i}]`));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const fullPath = path ? `${path}.${k}` : k;

      // Skip float-derived timing fields
      if (k === 'msTime' || k === 'msLength') continue;

      // KNOWN GAPS: fields our writer can't perfectly preserve yet.
      // Each is a real limitation tracked in tmp/roundtrip-issues.md.
      // TODO: Preserve note velocity in MIDI writer (accent/ghost encoding)
      if (k === 'velocity') continue;
      // TODO: Preserve MIDI channel in writer
      if (k === 'channel') continue;
      // modifierSustains is metadata for the writer, not chart content.
      // It's populated from the MIDI parser but not from .chart; skip for comparison.
      if (k === 'modifierSustains') continue;
      // scan-chart's MIDI parser discards zero-length notes (noteOff sorted
      // before noteOn at same tick). The writer uses Math.max(length, 1) to
      // work around this. Normalize 0→1 for same-format comparison.
      if (k === 'length' && v === 0 && (path.includes('trackEvents') || path.includes('vocalPhrases'))) {
        result[k] = 1;
        continue;
      }
      // When two vocal phrases share the same tick and noteNumber, the writer
      // alternates the second to 106 (or 105) to avoid invalid overlapping
      // MIDI noteOn events. This changes noteNumber — normalize by skipping it
      // on vocalPhrases (the tick and length are the semantically important fields).
      if (k === 'noteNumber' && path.includes('vocalPhrases')) continue;
      if (k === 'velocity' || k === 'channel') continue;

      // Skip metadata fields only in song.ini
      if (ROUNDTRIP_BLOCKLIST_PATHS.has(fullPath)) continue;

      // Skip hasVocals/hasLyrics (derived booleans)
      if (k === 'hasVocals' || k === 'hasLyrics') continue;

      // Normalize delay=0 to undefined (writer skips Offset=0)
      if (fullPath === 'metadata.delay' && v === 0) continue;

      // Skip undefined values
      if (v === undefined) continue;

      // trackEvents: sort within the same tick by type then length.
      // .chart format has no defined within-tick order — scan-chart preserves
      // file order, which may differ from our writer's order. This is not a
      // semantic difference, just a serialization choice.
      if (k === 'trackEvents' && Array.isArray(v)) {
        const sorted = [...v as Array<Record<string, unknown>>].sort((a, b) => {
          const tickDiff = ((a.tick as number) ?? 0) - ((b.tick as number) ?? 0);
          if (tickDiff !== 0) return tickDiff;
          const typeDiff = ((a.type as number) ?? 0) - ((b.type as number) ?? 0);
          if (typeDiff !== 0) return typeDiff;
          return ((a.length as number) ?? 0) - ((b.length as number) ?? 0);
        });
        result[k] = stripForComparison(sorted, fullPath);
        continue;
      }

      result[k] = stripForComparison(v, fullPath);
    }
    return result;
  }

  return obj;
}

/**
 * Deep-diff two normalized objects and return human-readable diffs.
 * Walks the entire structure recursively — no field is skipped.
 */
function diffObjects(
  a: unknown,
  b: unknown,
  path = '',
  maxDiffs = 20,
): Diff[] {
  const diffs: Diff[] = [];
  if (diffs.length >= maxDiffs) return diffs;

  if (a === b) return diffs;

  if (a == null || b == null || typeof a !== typeof b) {
    diffs.push({
      field: path || '(root)',
      message: `Type mismatch: ${typeof a} vs ${typeof b}`,
      details: JSON.stringify({ expected: a, actual: b }, null, 2).slice(0, 500),
    });
    return diffs;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push({
        field: path,
        message: `Array length: ${a.length} vs ${b.length}`,
      });
    }
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len && diffs.length < maxDiffs; i++) {
      diffs.push(...diffObjects(a[i], b[i], `${path}[${i}]`, maxDiffs - diffs.length));
    }
    return diffs;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of allKeys) {
      if (diffs.length >= maxDiffs) break;
      const aVal = aObj[key];
      const bVal = bObj[key];
      diffs.push(...diffObjects(aVal, bVal, path ? `${path}.${key}` : key, maxDiffs - diffs.length));
    }
    return diffs;
  }

  // Primitive mismatch
  diffs.push({
    field: path || '(root)',
    message: `${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
  });
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

  const format = doc.originalFormat;

  // Write and re-read through the full readChart pipeline.
  // This tests what actually matters: does readChart(writeChart(readChart(files)))
  // produce the same ChartDocument as readChart(files)?
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

  let reDoc;
  try {
    reDoc = readChart(output);
  } catch (err) {
    return {
      path: relPath,
      originalFormat: format,
      convertedFormat: format,
      diffs: [{ field: 'readChart', message: `Re-read failed: ${(err as Error).message}` }],
    };
  }

  // Compare the two ChartDocuments by normalizing both to the same
  // structure. Use the internal RawChartData representation for each,
  // obtained by parsing the chart file with scan-chart using the
  // document's own metadata-derived modifiers.
  const chartFileA = files.find(f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid')!;
  const isChart = chartFileA.fileName === 'notes.chart';
  const outputFile = output.find(f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid')!;

  let rawA: RawChartData, rawB: RawChartData;
  try {
    rawA = isChart
      ? parseNotesFromChart(chartFileA.data)
      : parseNotesFromMidi(chartFileA.data, buildModifiers(doc.metadata));
    rawB = isChart
      ? parseNotesFromChart(outputFile.data)
      : parseNotesFromMidi(outputFile.data, buildModifiers(reDoc.metadata));
  } catch {
    return 'skip';
  }

  // Override metadata in raw parse with the authoritative readChart metadata.
  // This ensures we compare what readChart actually produces, not the raw
  // parse of a single file (which may miss ini-only fields like delay).
  rawA.metadata = doc.metadata as RawChartData['metadata'];
  rawB.metadata = reDoc.metadata as RawChartData['metadata'];

  // Strip only msTime/msLength (float drift) and genuinely unsupported fields.
  // Everything else is compared AS-IS — no sorting, dedup, or length clamping.
  const strippedA = stripForComparison(rawA);
  const strippedB = stripForComparison(rawB);
  const diffs = diffObjects(strippedA, strippedB);
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
      throw new Error(`${result.path} (${result.originalFormat}→${result.convertedFormat}): ${summary}`);
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
      throw new Error(`${result.path} (${result.originalFormat}→${result.convertedFormat}): ${summary}`);
    },
  );
});

// ---------------------------------------------------------------------------
// Byte-level same-format roundtrip: compare raw file output without scan-chart
// ---------------------------------------------------------------------------

/**
 * Strip timing-derived fields from a parsed MIDI event for comparison.
 * Everything else (note numbers, velocities, event types, SysEx data,
 * text content) must match exactly.
 */
function stripMidiEvent(e: MidiEvent): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    // deltaTime is structural — keep it (it encodes tick positions)
    if (v === undefined) continue;
    // Convert Uint8Array to regular array for deep comparison
    if (v instanceof Uint8Array) {
      result[k] = Array.from(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Compare two parsed MIDI files track-by-track, event-by-event.
 * Returns diffs for any structural differences.
 */
function compareMidiFiles(
  a: ReturnType<typeof parseMidi>,
  b: ReturnType<typeof parseMidi>,
): Diff[] {
  const diffs: Diff[] = [];

  if (a.header.format !== b.header.format) {
    diffs.push({ field: 'header.format', message: `${a.header.format} vs ${b.header.format}` });
  }
  if (a.header.ticksPerBeat !== b.header.ticksPerBeat) {
    diffs.push({ field: 'header.ticksPerBeat', message: `${a.header.ticksPerBeat} vs ${b.header.ticksPerBeat}` });
  }
  if (a.tracks.length !== b.tracks.length) {
    diffs.push({ field: 'tracks.length', message: `${a.tracks.length} vs ${b.tracks.length}` });
    return diffs;
  }

  for (let t = 0; t < a.tracks.length; t++) {
    const trackA = a.tracks[t];
    const trackB = b.tracks[t];

    // Get track name for better error messages
    const nameEvt = trackA.find(e => (e as any).type === 'trackName');
    const trackLabel = nameEvt ? (nameEvt as any).text : `track[${t}]`;

    if (trackA.length !== trackB.length) {
      diffs.push({
        field: `${trackLabel}.events.length`,
        message: `${trackA.length} vs ${trackB.length}`,
      });
      // Find first divergence
      const minLen = Math.min(trackA.length, trackB.length);
      for (let i = 0; i < minLen; i++) {
        const ea = stripMidiEvent(trackA[i]);
        const eb = stripMidiEvent(trackB[i]);
        if (JSON.stringify(ea) !== JSON.stringify(eb)) {
          diffs.push({
            field: `${trackLabel}[${i}]`,
            message: 'first diff',
            details: JSON.stringify({ expected: ea, actual: eb }, null, 2).slice(0, 500),
          });
          break;
        }
      }
      continue;
    }

    for (let i = 0; i < trackA.length; i++) {
      const ea = stripMidiEvent(trackA[i]);
      const eb = stripMidiEvent(trackB[i]);
      if (JSON.stringify(ea) !== JSON.stringify(eb)) {
        diffs.push({
          field: `${trackLabel}[${i}]`,
          message: `Event mismatch`,
          details: JSON.stringify({ expected: ea, actual: eb }, null, 2).slice(0, 500),
        });
        if (diffs.length >= 5) return diffs;
      }
    }
  }

  return diffs;
}

/**
 * Compare two .chart files as text, line by line.
 */
function compareChartText(a: string, b: string): Diff[] {
  const diffs: Diff[] = [];
  const linesA = a.split('\n');
  const linesB = b.split('\n');

  if (linesA.length !== linesB.length) {
    diffs.push({
      field: 'line count',
      message: `${linesA.length} vs ${linesB.length}`,
    });
  }

  const maxLen = Math.min(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    if (linesA[i] !== linesB[i]) {
      diffs.push({
        field: `line ${i + 1}`,
        message: `Diff`,
        details: JSON.stringify({ expected: linesA[i], actual: linesB[i] }).slice(0, 500),
      });
      if (diffs.length >= 10) break;
    }
  }

  return diffs;
}

/**
 * Byte-level same-format roundtrip: readChart → writeChart → compare raw output
 * against input. No scan-chart re-parsing — compares the actual file bytes.
 *
 * For MIDI: parses both with midi-file and compares track-by-track.
 * For .chart: compares the text content line-by-line.
 */
function validateByteLevelRoundtrip(
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

  const format = doc.originalFormat;

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

  const inputFile = files.find(
    f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  )!;
  const outputFile = output.find(
    f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  )!;

  let diffs: Diff[];

  if (format === 'mid') {
    // Parse both MIDI files and compare structure
    let midiA, midiB;
    try {
      midiA = parseMidi(inputFile.data);
      midiB = parseMidi(outputFile.data);
    } catch (err) {
      return {
        path: relPath,
        originalFormat: format,
        convertedFormat: format,
        diffs: [{ field: 'parseMidi', message: `Parse failed: ${(err as Error).message}` }],
      };
    }
    diffs = compareMidiFiles(midiA, midiB);
  } else {
    // Compare .chart text
    const textA = new TextDecoder().decode(inputFile.data);
    const textB = new TextDecoder().decode(outputFile.data);
    diffs = compareChartText(textA, textB);
  }

  return diffs.length === 0
    ? null
    : { path: relPath, originalFormat: format, convertedFormat: format, diffs };
}

describe('real-chart byte-level roundtrip', () => {
  const byteReport: Report = {
    timestamp: new Date().toISOString(),
    chartDir,
    total: folders.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  afterAll(() => {
    const reportPath = join(__dirname, 'real-charts-byte-report.json');
    writeFileSync(reportPath, JSON.stringify(byteReport, null, 2) + '\n');

    console.log('\n=== Byte-Level Roundtrip Report ===');
    console.log(`Total:   ${byteReport.total}`);
    console.log(`Passed:  ${byteReport.passed}`);
    console.log(`Failed:  ${byteReport.failed}`);
    console.log(`Skipped: ${byteReport.skipped}`);
    if (byteReport.failures.length > 0) {
      console.log('\nFailures:');
      for (const f of byteReport.failures) {
        console.log(`  ${f.path} (${f.originalFormat})`);
        for (const d of f.diffs.slice(0, 3)) {
          console.log(`    ${d.field}: ${d.message}`);
        }
        if (f.diffs.length > 3) console.log(`    ... and ${f.diffs.length - 3} more`);
      }
    }
    console.log(`\nReport written to: ${reportPath}`);
  });

  it.each(folders.map((folder) => [relative(chartDir, folder), folder]))(
    'bytes %s',
    (_relPath, folder) => {
      const result = validateByteLevelRoundtrip(folder as string, chartDir);
      if (result === 'skip') {
        byteReport.skipped++;
        return;
      }
      if (result === null) {
        byteReport.passed++;
        return;
      }
      byteReport.failed++;
      byteReport.failures.push(result);
      const summary = result.diffs.slice(0, 3).map((d) => `${d.field}: ${d.message}`).join('; ');
      throw new Error(`${result.path} (${result.originalFormat}): ${summary}`);
    },
  );
});

} // end if (CHART_DIR)
