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
import {normalizeTimeSignatures} from './bar-derivation';
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
// Song start, lead-in bars and the opening (plan 0124 step 1)
// ---------------------------------------------------------------------------

/** Where the song's first downbeat sits inside the ORIGINAL audio. Always
 *  set by the user: the tempo map cannot supply it, because its `origin_ms`
 *  is grid phase and always lands within one bar of audio sample 0. */
export interface SongStart {
  audioMs: number;
}

/** Whole bars of lead-in the user has asked for. Absent means the opening
 *  has never been emitted, which is also what `resolveOpening` keys on. */
export interface LeadIn {
  bars: number;
}

export interface OpeningMeter {
  numerator: number;
  denominator: number;
}

/**
 * The song's real opening, recorded when a synctrack becomes a chart.
 *
 * That moment is the only one where the values are in hand and no lead-in
 * construct exists: `buildSyncLayout` wraps tick 0 in a stretched segment, a
 * partial bar or a collapse marker, and after that the chart cannot be asked
 * what the song's opening was. Two earlier designs tried to infer it from the
 * chart's shape and both rewrote real charts (plan 0124, "Where `barMs`
 * comes from").
 */
export interface Opening {
  bpm: number;
  meter: OpeningMeter;
}

/**
 * Every record the editor keeps beside the chart itself. A `.chart` file has
 * nowhere to carry them, so they are own-properties on the document, mirrored
 * into project metadata, and copied whenever a command rebuilds the doc.
 *
 * One type, so the list exists once: both project stores extend it, the
 * mirror and the re-attach are two functions rather than four assignments
 * each, and a new record is a one-line change instead of a seven-site one.
 */
export interface DocSidecars {
  audioAnchor?: AudioAnchor | null | undefined;
  songStart?: SongStart | null | undefined;
  leadIn?: LeadIn | null | undefined;
  opening?: Opening | null | undefined;
}

type DocWithRecords = ChartDocument & {
  songStart?: SongStart | null;
  leadIn?: LeadIn | null;
  opening?: Opening | null;
};

export function getSongStart(doc: ChartDocument): SongStart | null {
  return (doc as DocWithRecords).songStart ?? null;
}

/** Returns a new doc with the song start set (or cleared). Does not mutate. */
export function setSongStart(
  doc: ChartDocument,
  songStart: SongStart | null,
): ChartDocument {
  return {...doc, songStart} as DocWithRecords;
}

export function getLeadIn(doc: ChartDocument): LeadIn | null {
  return (doc as DocWithRecords).leadIn ?? null;
}

export function setLeadIn(
  doc: ChartDocument,
  leadIn: LeadIn | null,
): ChartDocument {
  return {...doc, leadIn} as DocWithRecords;
}

export function getOpening(doc: ChartDocument): Opening | null {
  return (doc as DocWithRecords).opening ?? null;
}

export function setOpening(
  doc: ChartDocument,
  opening: Opening | null,
): ChartDocument {
  return {...doc, opening} as DocWithRecords;
}

/** The doc's sidecars, for mirroring into project metadata. */
export function readDocSidecars(doc: ChartDocument): DocSidecars {
  return {
    audioAnchor: getAudioAnchor(doc),
    songStart: getSongStart(doc),
    leadIn: getLeadIn(doc),
    opening: getOpening(doc),
  };
}

/** Attach sidecars to a doc — reading them back off project metadata, or
 *  carrying them across a rebuild. Absent fields are left as they are, so a
 *  partial record (an older project) does not clear what is already set. */
export function applyDocSidecars(
  doc: ChartDocument,
  sidecars: DocSidecars,
): ChartDocument {
  let out = doc;
  if (sidecars.audioAnchor !== undefined) {
    out = setAudioAnchor(out, sidecars.audioAnchor);
  }
  if (sidecars.songStart !== undefined) {
    out = setSongStart(out, sidecars.songStart);
  }
  if (sidecars.leadIn !== undefined) out = setLeadIn(out, sidecars.leadIn);
  if (sidecars.opening !== undefined) out = setOpening(out, sidecars.opening);
  return out;
}

/** Copy every sidecar from one doc to another, for the commands that rebuild
 *  a doc through `swapSynctrack`. */
export function carryDocSidecars(
  from: ChartDocument,
  to: ChartDocument,
): ChartDocument {
  return applyDocSidecars(to, readDocSidecars(from));
}

/**
 * Move a synctrack from the original-audio frame into a padded chart's frame.
 *
 * Assist tasks measure on the original audio (`loadOriginalBytes`), so a map
 * installed on a padded chart has to move by the pad first. Installing it
 * unshifted puts every tempo change one pad early.
 */
export function shiftSynctrackMs(sync: Synctrack, deltaMs: number): Synctrack {
  return {
    origin_ms: sync.origin_ms + deltaMs,
    tempos: sync.tempos.map(t => ({...t, ms: t.ms + deltaMs})),
    timeSignatures: sync.timeSignatures.map(t => ({...t, ms: t.ms + deltaMs})),
  };
}

/**
 * Record the opening from the synctrack being installed. Call it at every
 * site where a synctrack becomes a chart: that is the one moment the real
 * tempo and meter are in hand, before `buildSyncLayout` wraps a lead-in
 * construct around tick 0.
 */
export function openingFromSync(
  doc: ChartDocument,
  sync: Synctrack,
): ChartDocument {
  const bpm = sync.tempos[0]?.bpm;
  if (bpm === undefined) return doc;
  const ts = sync.timeSignatures[0];
  return setOpening(doc, {
    bpm,
    meter: {
      numerator: ts?.numerator ?? 4,
      denominator: ts?.denominator ?? 4,
    },
  });
}

export type ResolvedOpening = Opening;

/**
 * The tempo and meter the lead-in's bar length is computed from.
 *
 * With a record: the recorded tempo, and 4/4. The prediction's numerator is
 * not used — it has 33.3% precision on meters that are not 4/4, and the
 * Python pipeline ships `force4` for the same reason.
 *
 * Without a record: the chart's own tick-0 values, unchanged. The one value
 * refused is a collapse marker, which is not music; there the next tempo is
 * used, because `barMs` at 20000 BPM is 12 ms and the lead-in would run to
 * hundreds of bars.
 */
export function resolveOpening(doc: ChartDocument): ResolvedOpening {
  const record = getOpening(doc);
  const chart = doc.parsedChart;

  // One predicate: has the opening been emitted yet? Once it has, tick 0
  // holds values this feature wrote, so the chart is the truth — including
  // any later edit to the opening meter, which must resize the pad rather
  // than be overruled by a stale 4/4.
  const emitted = getLeadIn(doc) !== null;
  if (emitted || !record) {
    const tempos = [...chart.tempos].sort((a, b) => a.tick - b.tick);
    let bpm = tempos[0]?.beatsPerMinute ?? 120;
    if (bpm >= COLLAPSE_BPM_MIN && tempos.length > 1) {
      bpm = tempos[1].beatsPerMinute;
    }
    return {bpm, meter: tsAt(0, chart.timeSignatures)};
  }

  // Before the first emit tick 0 is the writer's construct, so the recorded
  // tempo stands, and the meter is 4/4: the predicted numerator has 33.3%
  // precision on meters that are not 4/4.
  return {bpm: record.bpm, meter: {numerator: 4, denominator: 4}};
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
  /** The pad: the WHOLE silence in front of the audio, not an amount to add
   *  to what is already there. The audio layer rounds it to whole samples
   *  when it pads (`anchorPadSamples`), so this stays in milliseconds and
   *  nothing here needs a sample rate.
   *
   *  What the chart shifts by is `padMs` minus the doc's current pad, and
   *  `applyLeadIn` derives that from the doc it is applying to. Storing the
   *  delta here would go stale the moment a plan outlived the doc it was
   *  measured against — which the assist task does by design. */
  padMs: number;
  /** N — whole lead-in bars. */
  bars: number;
  bpm0: number;
  numerator: number;
  denominator: number;
  /** Writer constructs in front of the song start that this plan removes. */
  droppedTempos: number;
  droppedTimeSignatures: number;
  /** The ms-domain synctrack to install via `swapSynctrack`, with the
   *  opening already emitted so `buildSyncLayout` infers nothing. */
  newSync: Synctrack;
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
 * Plan the lead-in the user asked for: `P = N * barMs - X`, with `X` the song
 * start in original-audio ms and `N` the bar count (plan 0124 step 2).
 *
 * `bars` is an explicit count — a `[+]`/`[-]` click or a Reset. Omit it for a
 * first press and the smallest legal count is chosen. Either way the
 * two-second floor applies, because the user is choosing the lead-in.
 *
 * Returns `null` when the song start is unset — the caller gates on that —
 * or when the pad already equals the target.
 */
export function planLeadIn(
  doc: ChartDocument,
  bars?: number,
): LeadingSilencePlan | null {
  return planPad(doc, bars, true);
}

/**
 * The bar count that best describes a pad this feature did not create (plan
 * 0124 step 8).
 *
 * A project padded by the old model has an anchor and no bar count. Rounding
 * its pad onto the bar grid moves it — by up to half a bar when the bounds
 * already hold, and by more when they do not, because a small pad rounds to
 * zero bars and the bounds then raise it. That is the price of putting an
 * arbitrary pad onto the grid, and the caller announces it rather than
 * pretending the pad is unchanged.
 */
export function barsForExistingPad(doc: ChartDocument): number | null {
  const songStart = getSongStart(doc);
  if (!songStart) return null;
  const padMs = getAudioAnchor(doc)?.ms ?? 0;
  if (padMs <= 0) return null;
  const {bpm, meter} = resolveOpening(doc);
  const barMs = ((meter.numerator * 4) / meter.denominator) * (60000 / bpm);
  if (!(barMs > 0)) return null;
  return Math.max(
    1,
    Math.round((padMs + Math.max(0, songStart.audioMs)) / barMs),
  );
}

/**
 * Re-plan the existing lead-in after something changed underneath it: the
 * opening tempo or meter, the song start, a new tempo map.
 *
 * The bar count is the doc's own, and the two-second floor does NOT apply.
 * The floor is cosmetic and alignment is not: enforcing it here would turn a
 * merely short lead-in into a song a whole bar out of place — at `X = 0`,
 * `N = 1`, 4/4, promoting 60 BPM to 240 makes a bar 1000 ms, and raising `N`
 * to clear 2000 ms would move the song a second against its audio.
 */
export function replanLeadIn(doc: ChartDocument): LeadingSilencePlan | null {
  // No lead-in yet means there is nothing to re-plan. A recompute must never
  // create silence the user did not ask for.
  if (getLeadIn(doc) === null) return null;
  return planPad(doc, undefined, false);
}

function planPad(
  doc: ChartDocument,
  bars: number | undefined,
  userChoice: boolean,
): LeadingSilencePlan | null {
  const chart = doc.parsedChart;
  const songStart = getSongStart(doc);
  if (!songStart) return null;
  // A chart with no tempo has no bar length, so there is nothing to pad by.
  if (chart.tempos.length === 0) return null;

  const X = Math.max(0, songStart.audioMs);
  const padOld = getAudioAnchor(doc)?.ms ?? 0;
  const opening = resolveOpening(doc);
  const {numerator, denominator} = opening.meter;
  const bpm0 = opening.bpm;
  const barMs = ((numerator * 4) / denominator) * (60000 / bpm0);
  if (!(barMs > 0)) return null;

  // Bound 3 works in the ORIGINAL audio frame, the one frame that does not
  // move: an event at chart ms `m` sits at `m - padOld` in the audio, and
  // after the pad it must land at or after tick 0.
  let earliestEventAudioMs = Infinity;
  for (const track of chart.trackData) {
    for (const group of track.noteEventGroups) {
      for (const note of group) {
        const audioMs = note.msTime - padOld;
        if (audioMs < earliestEventAudioMs) earliestEventAudioMs = audioMs;
      }
    }
  }

  const lower = [X];
  if (userChoice) lower.push(LEAD_MIN_MS);
  if (Number.isFinite(earliestEventAudioMs)) {
    lower.push(X - earliestEventAudioMs);
  }
  const minBars = Math.max(1, ...lower.map(v => Math.ceil(v / barMs - 1e-9)));
  const requested = bars ?? getLeadIn(doc)?.bars ?? minBars;

  const barCount = Math.max(minBars, requested);

  const padMs = barCount * barMs - X;
  if (Math.abs(padMs - padOld) < 1e-9) return null;

  // The emitted opening (step 3). The song start's position in the NEW chart
  // frame is the boundary: everything the writer put in front of it exists
  // only to satisfy `ms(tick 0) = 0`, and shifting it forward would let
  // `buildSyncLayout` manufacture a fresh construct on top of it.
  const songStartChartMs = X + padMs;
  const sync = synctrackFromChart(chart);
  const shift = (ms: number) => ms - padOld + padMs;
  const afterSongStart = (ms: number) => ms > songStartChartMs + 1e-6;

  const keptTempos = sync.tempos
    .map(t => ({ms: shift(t.ms), bpm: t.bpm}))
    .filter(t => afterSongStart(t.ms));
  const keptTimeSignatures = sync.timeSignatures
    .map(t => ({...t, ms: shift(t.ms)}))
    .filter(t => afterSongStart(t.ms));

  return {
    padMs,
    bars: barCount,
    bpm0,
    numerator,
    denominator,
    droppedTempos: sync.tempos.length - keptTempos.length,
    droppedTimeSignatures:
      sync.timeSignatures.length - keptTimeSignatures.length,
    newSync: {
      origin_ms: 0,
      tempos: [{ms: 0, bpm: bpm0}, ...keptTempos],
      timeSignatures: [{ms: 0, numerator, denominator}, ...keptTimeSignatures],
    },
  };
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
 * Take a re-planned pad WITHOUT shifting the chart (plan 0124 step 6).
 *
 * For an edit that kept every tick — promoting the opening tempo — the events
 * have already moved into the new grid: `retimeChart` recomputed their ms
 * from ticks the edit did not touch, which changes each one by exactly the
 * lead-in's own change in duration. Shifting them again by `P_new - P_old`
 * would count that twice and take the music off its audio by that amount.
 *
 * So the pad is adopted, not applied: the anchor and the bar count move, the
 * chart does not.
 */
export function adoptLeadInPad(
  doc: ChartDocument,
  plan: LeadingSilencePlan,
): ChartDocument {
  const timed = buildTimedTempos(
    doc.parsedChart.tempos,
    doc.parsedChart.resolution,
  );
  const tick = msToTick(plan.padMs, timed, doc.parsedChart.resolution);
  return setLeadIn(setAudioAnchor(doc, {ms: plan.padMs, tick}), {
    bars: plan.bars,
  });
}

/**
 * Apply a lead-in plan: shift every event by the difference between the new
 * pad and the doc's current one, install the emitted synctrack, and re-tick
 * (plan 0124 steps 2 and 3).
 *
 * The shift is a difference, not the whole pad: the pad is absolute, so
 * shifting by all of it on a second press would move the chart twice. The
 * anchor is set to `padMs`, never added to, which is what `usePaddedAudio`
 * already assumes — it keeps the original PCM and re-pads from source.
 */
export function applyLeadIn(
  doc: ChartDocument,
  plan: LeadingSilencePlan,
): ChartDocument {
  const cloned = cloneDocForLeadingSilence(doc);
  const chart = cloned.parsedChart;

  // Derived here, not carried on the plan: a plan can outlive the doc it was
  // measured against (the assist task re-reads the doc after padding audio),
  // and the shift must describe the doc actually being changed.
  shiftChartMs(chart, plan.padMs - (getAudioAnchor(doc)?.ms ?? 0));

  const swapped = swapSynctrack(chart, plan.newSync, {
    quantizeNotes: false,
    sectionPolicy: 'preserve',
  });

  for (const track of swapped.trackData) {
    track.noteEventGroups = nudgeNoteCollisions(track.noteEventGroups);
  }

  retimeChart(swapped);

  const withChart: ChartDocument = {...cloned, parsedChart: swapped};

  const timedNew = buildTimedTempos(swapped.tempos, swapped.resolution);
  const anchorTick = msToTick(plan.padMs, timedNew, swapped.resolution);

  return setLeadIn(
    setAudioAnchor(withChart, {ms: plan.padMs, tick: anchorTick}),
    {bars: plan.bars},
  );
}
