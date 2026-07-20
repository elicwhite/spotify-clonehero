/**
 * Leading-silence padding (plan 0064): pad the start of the audio in-memory
 * so the chart opens on the real time signature and real tempo — whole
 * lead-in bars, no synthetic collapse marker or partial first bar.
 *
 * The stored audio at rest is never touched (0064 editor-button addendum
 * §5/§6). This module only computes the pad amount and re-ticks the chart's
 * events into the padded ms domain; the caller (EditorApp) is responsible
 * for padding the decoded PCM by the same sample count.
 *
 * The chart-time position of original audio sample 0 is tracked as an
 * `audioAnchor` on the `ChartDocument` (§1 of the addendum) so later tempo
 * edits at the start of the track can keep the silence amount in sync
 * (`refreshAnchorKeepMs` / `refreshAnchorKeepTick`, used by tempo commands).
 */

import type {ChartDocument, ParsedChart, NoteEvent} from './types';
import {retimeChart} from './retime';
import {synctrackFromChart, nudgeNoteCollisions} from './tempo-remap';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {
  buildTimedTempos,
  tickToMs,
  msToTick,
} from '@/lib/drum-transcription/timing';
import {normalizeTimeSignatures, deriveBeatGrid} from './bar-derivation';
import type {Synctrack} from '@/lib/tempo-map/types';

// ---------------------------------------------------------------------------
// Audio anchor accessors (0064 addendum §1)
// ---------------------------------------------------------------------------

export interface AudioAnchor {
  /** Chart tick corresponding to original audio sample 0. */
  tick: number;
  /** Chart ms corresponding to original audio sample 0. */
  ms: number;
}

/**
 * `audioAnchor` is stored as an extra own-enumerable property directly on
 * the `ChartDocument` object (scan-chart's type has no such field). This is
 * the one place in the codebase that casts to reach it — every other
 * consumer must go through `getAudioAnchor`/`setAudioAnchor`. Being a plain
 * own property (not a Map/WeakMap keyed elsewhere) means it survives every
 * `{...doc}` shallow clone the editor's command/undo machinery does, which
 * is required for whole-doc undo snapshots to restore it correctly.
 */
type DocWithAnchor = ChartDocument & {audioAnchor?: AudioAnchor | null};

export function getAudioAnchor(doc: ChartDocument): AudioAnchor | null {
  return (doc as DocWithAnchor).audioAnchor ?? null;
}

/** Returns a new doc with `anchor` set (or cleared, for `null`). Does not mutate `doc`. */
export function setAudioAnchor(
  doc: ChartDocument,
  anchor: AudioAnchor | null,
): ChartDocument {
  return {...doc, audioAnchor: anchor} as DocWithAnchor;
}

// ---------------------------------------------------------------------------
// Anchor refresh helpers (0064 addendum §2 — audio-glue / grid-glue parity)
// ---------------------------------------------------------------------------

/** Recompute `anchor.tick` from `anchor.ms` under the doc's CURRENT tempo
 * map. No-op when there is no anchor. Mirrors the KEEP-MS ("audio glue")
 * semantics tempo hand-edits already use for notes. */
export function refreshAnchorKeepMs(doc: ChartDocument): ChartDocument {
  const anchor = getAudioAnchor(doc);
  if (!anchor) return doc;
  const timed = buildTimedTempos(
    doc.parsedChart.tempos,
    doc.parsedChart.resolution,
  );
  const tick = msToTick(anchor.ms, timed, doc.parsedChart.resolution);
  return setAudioAnchor(doc, {tick, ms: anchor.ms});
}

/** Recompute `anchor.ms` from `anchor.tick` under the doc's CURRENT tempo
 * map. No-op when there is no anchor. Mirrors the KEEP-TICKS ("grid glue")
 * semantics tempo hand-edits already use for notes. */
export function refreshAnchorKeepTick(doc: ChartDocument): ChartDocument {
  const anchor = getAudioAnchor(doc);
  if (!anchor) return doc;
  const timed = buildTimedTempos(
    doc.parsedChart.tempos,
    doc.parsedChart.resolution,
  );
  const ms = tickToMs(anchor.tick, timed, doc.parsedChart.resolution);
  return setAudioAnchor(doc, {tick: anchor.tick, ms});
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** Human census p10 first-note time (2015ms), rounded down (plan 0064). */
export const LEAD_MIN_MS = 2000;

/** BPM at/above which an opening tempo marker is recognized as a
 * `buildSyncLayout` tier-(c)/negative-origin collapse marker (compresses a
 * sub-beat/negative pre-audio region into a near-instant segment) rather
 * than real music. */
export const COLLAPSE_BPM_MIN = 5000;

export interface LeadingSilencePlan {
  /** Sample-quantized pad amount, P' in the plan. */
  padMs: number;
  padSamples: number;
  /** N — whole lead-in bars added. */
  bars: number;
  bpm0: number;
  numerator: number;
  denominator: number;
  /** The padded ms-domain synctrack to install via `swapSynctrack`. */
  newSync: Synctrack;
}

/** First downbeat-aligned tick at/after `tick`, per the TS region active at
 * `tick` (denominator-aware bar length, via the shared bar-derivation
 * helpers). Reuses `normalizeTimeSignatures` for the tick-0-anchored region
 * list and `deriveBeatGrid`'s downbeat filter for the search. */
function firstDownbeatAtOrAfter(
  tick: number,
  timeSignatures: ParsedChart['timeSignatures'],
  resolution: number,
): number {
  const regions = normalizeTimeSignatures(timeSignatures);
  let active = regions[0];
  for (const r of regions) {
    if (r.tick <= tick) active = r;
    else break;
  }
  const barBeats = Math.max(1, (active.numerator * 4) / active.denominator);
  const barTicks = barBeats * resolution;
  // A generous search window: the answer is within one bar of `tick`, but
  // deriveBeatGrid needs an explicit end. 4 bars covers exotic meters too.
  const endTick = tick + barTicks * 4;
  const beats = deriveBeatGrid(timeSignatures, resolution, endTick);
  const found = beats.find(b => b.isDownbeat && b.tick >= tick);
  if (found) return found.tick;
  // Fallback (shouldn't happen given the search window): round up within
  // the active region analytically.
  const offset = tick - active.tick;
  const bars = Math.ceil(offset / barTicks - 1e-9);
  return active.tick + bars * barTicks;
}

/** BPM governing `tick` from a tick-sorted tempo list (last tempo at/before
 * `tick`; the list is assumed to start at tick 0, as every parsed chart
 * guarantees). */
function bpmAt(tick: number, tempos: ParsedChart['tempos']): number {
  let bpm = tempos[0]?.beatsPerMinute ?? 120;
  for (const t of tempos) {
    if (t.tick <= tick) bpm = t.beatsPerMinute;
    else break;
  }
  return bpm;
}

/** Time signature governing `tick` (default 4/4 when the chart has none). */
function tsAt(
  tick: number,
  timeSignatures: ParsedChart['timeSignatures'],
): {numerator: number; denominator: number} {
  const regions = normalizeTimeSignatures(timeSignatures);
  let active = regions[0];
  for (const r of regions) {
    if (r.tick <= tick) active = r;
    else break;
  }
  return {numerator: active.numerator, denominator: active.denominator};
}

/**
 * Compute the leading-silence pad plan for `doc` (plan 0064 + editor-button
 * addendum §3). Returns `null` when there is nothing to pad: no tempos, or
 * the sample-quantized pad rounds to less than half a sample-period.
 */
export function planLeadingSilence(
  doc: ChartDocument,
  sampleRate: number,
): LeadingSilencePlan | null {
  const chart = doc.parsedChart;
  const resolution = chart.resolution;
  const sync = synctrackFromChart(chart);
  if (sync.tempos.length === 0) return null;

  const tempos = [...chart.tempos].sort((a, b) => a.tick - b.tick);
  const isCollapse =
    sync.tempos.length > 1 && sync.tempos[0].bpm >= COLLAPSE_BPM_MIN;

  let originMs: number;
  let bpm0: number;
  let numerator: number;
  let denominator: number;

  if (isCollapse) {
    const survivorTick = tempos[1].tick;
    const originTick = firstDownbeatAtOrAfter(
      survivorTick,
      chart.timeSignatures,
      resolution,
    );
    const timedFull = buildTimedTempos(tempos, resolution);
    originMs = tickToMs(originTick, timedFull, resolution);
    bpm0 = bpmAt(originTick, tempos);
    ({numerator, denominator} = tsAt(originTick, chart.timeSignatures));
  } else {
    originMs = 0;
    bpm0 = sync.tempos[0].bpm;
    const ts0 = chart.timeSignatures[0];
    numerator = ts0?.numerator ?? 4;
    denominator = ts0?.denominator ?? 4;
  }

  const barBeats = (numerator * 4) / denominator;
  const barMs = (barBeats * 60000) / bpm0;

  let firstNoteMs = Infinity;
  for (const track of chart.trackData) {
    for (const group of track.noteEventGroups) {
      for (const note of group) {
        if (note.msTime < firstNoteMs) firstNoteMs = note.msTime;
      }
    }
  }

  const pMin = Math.max(0, LEAD_MIN_MS - firstNoteMs);
  const bars = Math.max(1, Math.ceil((originMs + pMin) / barMs - 1e-6));
  const padMsExact = bars * barMs - originMs;

  const padSamples = Math.round((padMsExact * sampleRate) / 1000);
  const padMs = (padSamples * 1000) / sampleRate;
  if (padMs < 0.5) return null;

  const newTempos = isCollapse
    ? [
        {ms: originMs + padMs, bpm: bpm0},
        ...sync.tempos
          .filter(t => t.ms > originMs)
          .map(t => ({ms: t.ms + padMs, bpm: t.bpm})),
      ]
    : sync.tempos.map(t => ({ms: t.ms + padMs, bpm: t.bpm}));

  const newTimeSignatures = sync.timeSignatures.map(t => ({
    ...t,
    ms: t.ms + padMs,
  }));

  const newSync: Synctrack = {
    origin_ms: newTempos[0].ms,
    tempos: newTempos,
    timeSignatures: newTimeSignatures,
  };

  return {padMs, padSamples, bars, bpm0, numerator, denominator, newSync};
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** Bump `msTime` (audio-relative position) on every timed event in place —
 * everything `swapSynctrack` re-ticks from `msTime` (see its source for the
 * exhaustive list). `msLength` values are durations, not positions, and are
 * left untouched. */
function shiftEventMs<T extends {msTime: number}>(
  events: T[],
  padMs: number,
): void {
  for (const e of events) e.msTime += padMs;
}

function shiftChartMs(chart: ParsedChart, padMs: number): void {
  for (const track of chart.trackData) {
    for (const group of track.noteEventGroups) shiftEventMs(group, padMs);
    shiftEventMs(track.starPowerSections, padMs);
    shiftEventMs(track.rejectedStarPowerSections, padMs);
    shiftEventMs(track.soloSections, padMs);
    shiftEventMs(track.flexLanes, padMs);
    shiftEventMs(track.drumFreestyleSections, padMs);
    shiftEventMs(track.textEvents, padMs);
    shiftEventMs(track.versusPhrases, padMs);
    shiftEventMs(track.animations, padMs);
  }
  shiftEventMs(chart.sections, padMs);
  shiftEventMs(chart.endEvents, padMs);
  shiftEventMs(chart.unrecognizedEventsTrackTextEvents, padMs);

  const vocalTracks = chart.vocalTracks;
  if (vocalTracks) {
    shiftEventMs(vocalTracks.rangeShifts, padMs);
    shiftEventMs(vocalTracks.lyricShifts, padMs);
    for (const part of Object.values(vocalTracks.parts)) {
      for (const phrases of [part.notePhrases, part.staticLyricPhrases]) {
        shiftEventMs(phrases, padMs);
        for (const phrase of phrases) {
          shiftEventMs(phrase.notes, padMs);
          shiftEventMs(phrase.lyrics, padMs);
        }
      }
      shiftEventMs(part.starPowerSections, padMs);
      shiftEventMs(part.rangeShifts, padMs);
      shiftEventMs(part.lyricShifts, padMs);
      shiftEventMs(part.textEvents, padMs);
    }
  }
}

function cloneTrack(track: ParsedChart['trackData'][number]) {
  return {
    ...track,
    noteEventGroups: track.noteEventGroups.map((g: NoteEvent[]) =>
      g.map(n => ({...n})),
    ),
    starPowerSections: track.starPowerSections.map(s => ({...s})),
    rejectedStarPowerSections: track.rejectedStarPowerSections.map(s => ({
      ...s,
    })),
    soloSections: track.soloSections.map(s => ({...s})),
    flexLanes: track.flexLanes.map(s => ({...s})),
    drumFreestyleSections: track.drumFreestyleSections.map(s => ({...s})),
    textEvents: track.textEvents.map(s => ({...s})),
    versusPhrases: track.versusPhrases.map(s => ({...s})),
    animations: track.animations.map(s => ({...s})),
  };
}

/** Deep-clone every array `applyLeadingSilence` mutates (event `msTime`
 * bumps, then `swapSynctrack`/`nudgeNoteCollisions`/`retimeChart`), mirroring
 * `cloneDocForRetime` in `components/chart-editor/commands.ts`. */
function cloneDocForLeadingSilence(doc: ChartDocument): ChartDocument {
  const chart = doc.parsedChart;
  return {
    ...doc,
    parsedChart: {
      ...chart,
      tempos: chart.tempos.map(t => ({...t})),
      timeSignatures: chart.timeSignatures.map(t => ({...t})),
      sections: chart.sections.map(s => ({...s})),
      endEvents: chart.endEvents.map(e => ({...e})),
      unrecognizedEventsTrackTextEvents:
        chart.unrecognizedEventsTrackTextEvents.map(e => ({...e})),
      trackData: chart.trackData.map(cloneTrack),
      vocalTracks: chart.vocalTracks
        ? structuredClone(chart.vocalTracks)
        : chart.vocalTracks,
    },
  };
}

/**
 * Apply a leading-silence plan: shift every event into the padded ms
 * domain, install the padded synctrack, and re-tick (0064 addendum §3).
 * Accumulates into any existing `audioAnchor` — a second press pads again
 * on top of the first.
 */
export function applyLeadingSilence(
  doc: ChartDocument,
  plan: LeadingSilencePlan,
): ChartDocument {
  const cloned = cloneDocForLeadingSilence(doc);
  const chart = cloned.parsedChart;

  shiftChartMs(chart, plan.padMs);

  const swapped = swapSynctrack(chart, plan.newSync, {
    quantizeNotes: false,
    sectionPolicy: 'preserve',
  });

  for (const track of swapped.trackData) {
    track.noteEventGroups = nudgeNoteCollisions(track.noteEventGroups);
  }

  retimeChart(swapped);

  const withChart: ChartDocument = {...cloned, parsedChart: swapped};

  const existingAnchor = getAudioAnchor(doc);
  const newAnchorMs = (existingAnchor?.ms ?? 0) + plan.padMs;
  const timedNew = buildTimedTempos(swapped.tempos, swapped.resolution);
  const newAnchorTick = msToTick(newAnchorMs, timedNew, swapped.resolution);

  return setAudioAnchor(withChart, {ms: newAnchorMs, tick: newAnchorTick});
}
