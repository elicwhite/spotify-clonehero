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
// Where the music starts (plan 0124 §3)
// ---------------------------------------------------------------------------

export interface OpeningMeter {
  numerator: number;
  denominator: number;
}

/** The tempo and meter the song opens on. */
export interface Opening {
  bpm: number;
  meter: OpeningMeter;
}

/**
 * Every record the editor keeps beside the chart itself. A `.chart` file has
 * nowhere to carry them, so they are own-properties on the document, mirrored
 * into project metadata, and copied whenever a command rebuilds the doc.
 *
 * Two fields, and everything else this feature needs is derived from them:
 * the pad `X = tickToMs(songStartTick) - audioAnchor.ms`, the lead-in bar
 * count, and the opening tempo and meter. Revision 9 of plan 0124 persisted
 * the bar count and the opening as records of their own, and both could go
 * stale against the chart they claimed to describe.
 *
 * A TICK is the right thing to persist. It does not move when the meter or
 * the tempo changes; a bar count and a millisecond position both do.
 */
export interface DocSidecars {
  audioAnchor?: AudioAnchor | null | undefined;
  songStartTick?: number | null | undefined;
}

/**
 * What a stored project may hold: the sidecars this version writes, plus the
 * ones older versions wrote. The old fields are read once on load and
 * converted (see {@link applyDocSidecars}); nothing writes them again.
 *
 * They live in their own type so the everyday shape stays two fields. A
 * caller that has a `DocSidecars` can pass it here unchanged.
 */
export interface StoredDocSidecars extends DocSidecars {
  songStart?: {audioMs: number} | null | undefined;
  leadIn?: {bars: number} | null | undefined;
}

type DocWithSongStart = ChartDocument & {songStartTick?: number | null};

/**
 * The chart tick where the music begins, or null when nothing has said.
 *
 * Set from the tempo map's own `musicStartMs` when a map is installed, or by
 * the user through the tempo lane. Null on a chart that arrived from
 * somewhere else, and the feature then says what it does not know rather
 * than guessing: with no song start the pad can only ever grow, because
 * trimming the front of a recording whose music you cannot locate is not a
 * risk worth taking.
 */
export function getSongStartTick(doc: ChartDocument): number | null {
  return (doc as DocWithSongStart).songStartTick ?? null;
}

/** Returns a new doc with the song start set (or cleared). Does not mutate. */
export function setSongStartTick(
  doc: ChartDocument,
  tick: number | null,
): ChartDocument {
  return {...doc, songStartTick: tick} as DocWithSongStart;
}

/**
 * How far a song start may sit from a sync marker and still be taken to mean
 * that marker: a 32nd note. Resolution-independent, and far below any
 * spacing a real tempo map uses — a beat at 154 BPM is 389 ms, this window
 * is 48.
 */
export const SONG_START_SNAP_TICKS_PER_QUARTER = 8;

/**
 * Record where the music starts, snapped onto a coincident tempo or
 * time-signature marker.
 *
 * The snap is what stops a near miss from producing a sliver. The emit keeps
 * every event strictly after the song start, so a song start a few ticks
 * BEFORE the marker the user meant leaves that marker alive a few
 * milliseconds after the emitted opening — a segment far too short to be
 * music, which the writer then has to cover at an absurd BPM. It also reads
 * the opening from the wrong side of that marker: the values in force a few
 * ticks earlier are the ones the song was supposed to leave behind.
 *
 * The window is a 32nd note, not the one-beat window an earlier design used.
 * That one moved the flag somewhere the user had not pointed. This one
 * corrects a miss no user could have intended, and the flag visibly lands on
 * the marker, so they can see that it took.
 *
 * Every route that records a song start goes through here — the tempo lane's
 * menu, the flag drag, the tempo map's own `musicStartMs`, and the migration
 * of an older project's record. A tick recorded by any other path would
 * carry exactly the near-miss this exists to remove.
 */
export function recordSongStart(
  doc: ChartDocument,
  tick: number,
): ChartDocument {
  return setSongStartTick(doc, snapSongStartTick(doc.parsedChart, tick));
}

/**
 * The snap itself: a tick in, a tick out. Split from
 * {@link recordSongStart} so a caller that only wants to know WHERE a click
 * would land — the menu, to decide whether its item is a no-op — can ask
 * without building a document to throw away.
 */
export function snapSongStartTick(chart: ParsedChart, tick: number): number {
  const window = Math.max(
    1,
    Math.round(chart.resolution / SONG_START_SNAP_TICKS_PER_QUARTER),
  );
  const target = Math.max(0, Math.round(tick));
  let best = target;
  let bestDistance = window;
  for (const event of [...chart.tempos, ...chart.timeSignatures]) {
    // Measured from the TARGET, not from the running best: comparing against
    // a moving reference would let a chain of markers walk the song start
    // away from where it was put.
    const distance = Math.abs(event.tick - target);
    // `<`, so a straddle resolves to the marker scanned first rather than to
    // whichever list happened to come last in the concatenation. Ties on the
    // SAME tick assign the same value either way; ties at equal distance on
    // DIFFERENT ticks are the case that needs a rule, and "keep the first
    // one found" is at least a stated one.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = event.tick;
    }
  }
  return best;
}

/** The doc's sidecars, for mirroring into project metadata. */
export function readDocSidecars(doc: ChartDocument): DocSidecars {
  return {
    audioAnchor: getAudioAnchor(doc),
    songStartTick: getSongStartTick(doc),
  };
}

/** Attach sidecars to a doc — reading them back off project metadata, or
 *  carrying them across a rebuild. Absent fields are left as they are, so a
 *  partial record (an older project) does not clear what is already set. */
export function applyDocSidecars(
  doc: ChartDocument,
  sidecars: StoredDocSidecars,
): ChartDocument {
  let out = doc;
  if (sidecars.audioAnchor !== undefined) {
    out = setAudioAnchor(out, sidecars.audioAnchor);
  }
  if (sidecars.songStartTick !== undefined) {
    return setSongStartTick(out, sidecars.songStartTick);
  }
  // An older project stored the song start as a position in the audio. The
  // anchor is applied first, so the tick it converts to is the one the chart
  // already holds: nothing about the chart moves.
  if (sidecars.songStart) {
    const chart = out.parsedChart;
    const padMs = getAudioAnchor(out)?.ms ?? 0;
    const timed = buildTimedTempos(chart.tempos, chart.resolution);
    out = recordSongStart(
      out,
      msToTick(sidecars.songStart.audioMs + padMs, timed, chart.resolution),
    );
  }
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
 * Record a song start given in CHART ms — the form the tempo map states it
 * in. Returns the doc unchanged when the producer said nothing.
 *
 * The ms→tick conversion rounds, so this goes through {@link recordSongStart}
 * like every other route: a rounded tick is exactly the near miss that
 * leaves a sliver.
 */
export function recordSongStartFromMs(
  doc: ChartDocument,
  ms: number | undefined,
): ChartDocument {
  // A map that cannot say clears the record rather than leaving the old one.
  // The tick it held described the PREVIOUS grid, and installing a map
  // re-ticks every event keep-ms, so the old tick now points somewhere else
  // in the music. "We do not know" is the honest state; the card says so and
  // the user can place the flag.
  if (ms === undefined) return setSongStartTick(doc, null);
  const chart = doc.parsedChart;
  const timed = buildTimedTempos(chart.tempos, chart.resolution);
  return recordSongStart(doc, msToTick(ms, timed, chart.resolution));
}

/**
 * Where the music sits inside the STORED audio, in ms — `X`. Null when no
 * song start is recorded.
 *
 * Derived, never stored: the chart ms of the song start, less the silence
 * the anchor says was put in front of the recording.
 */
export function songStartAudioMs(doc: ChartDocument): number | null {
  const chartMs = songStartChartMsOf(doc);
  return chartMs === null ? null : chartMs - (getAudioAnchor(doc)?.ms ?? 0);
}

/** The song start in CHART ms — the tick read under the doc's own tempos. */
function songStartChartMsOf(doc: ChartDocument): number | null {
  const tick = getSongStartTick(doc);
  if (tick == null) return null;
  const chart = doc.parsedChart;
  const timed = buildTimedTempos(chart.tempos, chart.resolution);
  return tickToMs(tick, timed, chart.resolution);
}

/**
 * Lead-in bars, as the chart currently expresses them. Null when no song
 * start is recorded.
 *
 * FRACTIONAL when the chart has moved out from under the lead-in — retyping
 * the opening meter from 4/4 to 3/4 turns two bars into 2.667. Nothing
 * corrects that on its own (plan 0124, "Nothing recomputes on its own"); the
 * card reports it and the user re-fits when they want to.
 */
export function leadInBars(doc: ChartDocument): number | null {
  const tick = getSongStartTick(doc);
  if (tick == null) return null;
  const {barTicks} = openingBar(doc);
  return barTicks > 0 ? tick / barTicks : null;
}

/**
 * One bar of the song's own opening, in both units.
 *
 * The single source for every bar length this feature uses. It reads
 * {@link resolveOpening}, so the count the card reports is in the same unit
 * the buttons add and remove — which is the whole point of reporting it.
 *
 * An earlier version measured the lead-in at TICK 0 instead. On a generated
 * chart those are different meters: with 3/4 at tick 0 and the song in 4/4
 * at tick 1440, tick 0 makes the lead-in "1 bar" and the song's own meter
 * makes it 0.75. The card believed the first, called it whole, and hid the
 * re-fit on the one chart shape the re-fit exists to repair.
 */
export function openingBar(doc: ChartDocument): {
  barMs: number;
  barTicks: number;
} {
  const {bpm, meter} = resolveOpening(doc);
  const barsPerWhole = (meter.numerator * 4) / meter.denominator;
  return {
    barMs: barsPerWhole * (60000 / bpm),
    barTicks: barsPerWhole * doc.parsedChart.resolution,
  };
}

/**
 * The tempo and meter the lead-in's bar length is computed from.
 *
 * Read AT THE SONG START, not at tick 0. Tick 0 holds whatever precedes the
 * music: a `buildSyncLayout` lead-in construct, or the user's own intro in
 * another meter. Reading tick 0 with the song start further in was
 * destructive rather than merely wrong — the emit keeps only what is strictly
 * after the song start, so the song start's own markers were dropped and the
 * intro's values written over the top, and a 3/4 168.4 intro ate a 4/4 150.5
 * song.
 *
 * With no song start the chart's own tick-0 values stand. The one value
 * refused there is a collapse marker, which is not music: `barMs` at 20000
 * BPM is 12 ms, and the lead-in would run to hundreds of bars.
 */
export function resolveOpening(doc: ChartDocument): Opening {
  const chart = doc.parsedChart;

  const songStartTick = getSongStartTick(doc);
  if (songStartTick != null) {
    return {
      bpm: bpmAt(songStartTick, chart.tempos),
      meter: tsAt(songStartTick, chart.timeSignatures),
    };
  }

  return {
    bpm: bpmAt(0, chart.tempos),
    meter: tsAt(0, chart.timeSignatures),
  };
}

/**
 * Move a synctrack from the original-audio frame into a padded chart's frame.
 *
 * Assist tasks measure on the original audio (`loadOriginalBytes`), so a map
 * installed on a padded chart has to move by the pad first. Installing it
 * unshifted puts every tempo change one pad early.
 */
export function shiftSynctrackMs(sync: Synctrack, deltaMs: number): Synctrack {
  // `...sync` first: this is the fourth transform that rebuilds a
  // `Synctrack`, and a literal listing only the required fields is how
  // `musicStartMs` went missing from the other three. Everything the map
  // carries survives by default; only what moves is named.
  return {
    ...sync,
    origin_ms: sync.origin_ms + deltaMs,
    tempos: sync.tempos.map(t => ({...t, ms: t.ms + deltaMs})),
    timeSignatures: sync.timeSignatures.map(t => ({...t, ms: t.ms + deltaMs})),
    ...(sync.musicStartMs === undefined
      ? {}
      : {musicStartMs: sync.musicStartMs + deltaMs}),
  };
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
   *  when it pads (`anchorShiftSamples`), so this stays in milliseconds and
   *  nothing here needs a sample rate.
   *
   *  What the chart shifts by is `padMs` minus the doc's current pad, and
   *  `applyLeadIn` derives that from the doc it is applying to. Storing the
   *  delta here would go stale the moment a plan outlived the doc it was
   *  measured against — which the assist task does by design. */
  padMs: number;
  /** N — whole lead-in bars. */
  bars: number;
  /** Writer constructs in front of the song start that this plan removes. */
  droppedTempos: number;
  droppedTimeSignatures: number;
  /** The ms-domain synctrack to install via `swapSynctrack`, with the
   *  opening already emitted so `buildSyncLayout` infers nothing. */
  newSync: Synctrack;
}

/**
 * BPM governing `tick` — the last tempo at or before it — refusing a collapse
 * marker.
 *
 * The refusal lives here, not at the call site, because "this BPM is not
 * music" needs one definition. It had two: the no-song-start branch of
 * `resolveOpening` checked, and the song-start branch — the one this plan
 * made primary — did not. A collapse marker at tick 0 with a song start
 * snapped onto it gives `barMs` of 12 at 20000 BPM, and a lead-in of 167
 * bars.
 *
 * The list is assumed tick-sorted and to start at tick 0, as every parsed
 * chart is.
 */
function bpmAt(tick: number, tempos: ParsedChart['tempos']): number {
  const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
  let index = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].tick <= tick) index = i;
    else break;
  }
  const bpm = sorted[index]?.beatsPerMinute ?? 120;
  if (bpm < COLLAPSE_BPM_MIN) return bpm;
  // Not music: `buildSyncLayout` writes these to cover a sub-beat or
  // negative-origin region. Take the next real tempo instead.
  const next = sorted
    .slice(index + 1)
    .find(t => t.beatsPerMinute < COLLAPSE_BPM_MIN);
  return next?.beatsPerMinute ?? bpm;
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
 * Plan the lead-in: `P = N * barMs - X`, with `X` the song start inside the
 * stored audio and `N` a whole number of bars (plan 0124 §4).
 *
 * `bars` is an explicit count — an Add-a-bar / Remove-a-bar click. Omit it
 * and the count is chosen: the doc's current one when it already has a
 * lead-in, otherwise the smallest count that clears the two-second floor and
 * leaves the recording's own opening silence in place.
 *
 * Returns null when the chart has no tempo to measure a bar with, or when
 * the pad already equals the target.
 */
export function planLeadIn(
  doc: ChartDocument,
  bars?: number,
): LeadingSilencePlan | null {
  const chart = doc.parsedChart;
  // A chart with no tempo has no bar length, so there is nothing to pad by.
  if (chart.tempos.length === 0) return null;

  const padOld = getAudioAnchor(doc)?.ms ?? 0;
  // With no song start recorded, `X` is 0: the music is taken to begin where
  // the pad already ends. `P = N * barMs` can then never go negative, so the
  // audio is never trimmed — the right refusal on a chart whose music we
  // cannot locate.
  const X = songStartAudioMs(doc) ?? 0;
  const opening = resolveOpening(doc);
  const {numerator, denominator} = opening.meter;
  const bpm0 = opening.bpm;
  const {barMs} = openingBar(doc);
  if (!(barMs > 0)) return null;

  // Measured in the stored-audio frame, the one frame that does not move:
  // an event at chart ms `m` sits at `m - padOld` there. Over EVERY timed
  // event, through the same traversal that shifts them — a bound that covers
  // less than the shift is a bound that lets something fall off tick 0.
  const earliestEventAudioMs = earliestEventMs(chart) - padOld;

  // Two lower bounds, and one this design deliberately does not have.
  //
  // The floor is on the WHOLE lead-in, not on what this press adds: the
  // census measured where the first note falls, not how much silence was
  // appended. It applies to a press with no count of its own — "Add leading
  // silence" — because an explicit count is an Add-a-bar / Remove-a-bar
  // click, and that is the user's own choice about their own chart.
  //
  // No event may end up before tick 0.
  //
  // And there is no `N * barMs >= X` bound. The anchor is signed, so a
  // lead-in shorter than the recording's own opening silence trims that
  // silence instead of failing, and the music is safe without the bound:
  // `P + X = N * barMs >= barMs`, so it always sits at least one whole bar
  // into the padded audio.
  const lower = bars === undefined ? [LEAD_MIN_MS] : [];
  if (Number.isFinite(earliestEventAudioMs)) {
    lower.push(X - earliestEventAudioMs);
  }
  const minBars = Math.max(1, ...lower.map(v => Math.ceil(v / barMs - 1e-9)));

  // Without an explicit count: the smallest whole number of bars that still
  // reaches the song start. On a chart this feature already padded that is
  // exactly the count it has, because the song start is a bar line under the
  // opening it emitted. On any other chart it rounds UP, which is what keeps
  // "Add leading silence" from taking seconds off the front of a recording
  // that opens with silence of its own.
  const barCount = Math.max(
    minBars,
    bars ?? Math.ceil((X + padOld) / barMs - 1e-9),
  );

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

/**
 * Visit every array of timed events the chart carries — everything
 * `swapSynctrack` re-ticks from `msTime` (see its source for the exhaustive
 * list). `msLength` values are durations, not positions, and are not visited.
 *
 * One traversal, because there are two questions about the same set and they
 * must not drift apart: which events MOVE when the lead-in changes, and which
 * events BOUND how far it may move. They used to be two hand-written lists,
 * and they differed — the shift covered twenty-odd arrays while the bound
 * scanned only `noteEventGroups`. That was invisible while the pad could not
 * go negative. With a signed anchor it means a section, a text event or a
 * lyric in front of the song start is shifted past tick 0, clamped there by
 * `reTickEvent`, and silently collapsed onto the same tick as everything else
 * that went with it.
 */
function forEachTimedEvents(
  chart: ParsedChart,
  visit: (events: {msTime: number}[]) => void,
): void {
  for (const track of chart.trackData) {
    for (const group of track.noteEventGroups) visit(group);
    visit(track.starPowerSections);
    visit(track.rejectedStarPowerSections);
    visit(track.soloSections);
    visit(track.flexLanes);
    visit(track.drumFreestyleSections);
    visit(track.textEvents);
    visit(track.versusPhrases);
    visit(track.animations);
  }
  visit(chart.sections);
  visit(chart.endEvents);
  visit(chart.unrecognizedEventsTrackTextEvents);

  const vocalTracks = chart.vocalTracks;
  if (!vocalTracks) return;
  visit(vocalTracks.rangeShifts);
  visit(vocalTracks.lyricShifts);
  for (const part of Object.values(vocalTracks.parts)) {
    for (const phrases of [part.notePhrases, part.staticLyricPhrases]) {
      visit(phrases);
      for (const phrase of phrases) {
        visit(phrase.notes);
        visit(phrase.lyrics);
      }
    }
    visit(part.starPowerSections);
    visit(part.rangeShifts);
    visit(part.lyricShifts);
    visit(part.textEvents);
  }
}

/** The earliest `msTime` any event in the chart holds, or `Infinity` for a
 *  chart with no timed events at all. */
function earliestEventMs(chart: ParsedChart): number {
  let earliest = Infinity;
  forEachTimedEvents(chart, events => {
    for (const e of events) if (e.msTime < earliest) earliest = e.msTime;
  });
  return earliest;
}

function shiftChartMs(chart: ParsedChart, padMs: number): void {
  forEachTimedEvents(chart, events => {
    for (const e of events) e.msTime += padMs;
  });
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
 * Resize the lead-in so the song stays where it is in the recording, after an
 * edit that kept every tick (plan 0124 §6).
 *
 * A tempo change at the opening makes the bars before the song longer or
 * shorter. Their COUNT does not change — ticks did not move — so the song
 * start slides in chart time by the difference, and the silence in front has
 * to take up exactly that difference or the whole song slides against its own
 * audio.
 *
 * Nothing here shifts an event: `retimeChart` has already moved every event's
 * ms into the new grid, and the caller's edit kept the ticks. Only the anchor
 * moves. Shifting as well would count the change twice.
 *
 * The pad may come out negative, which trims the front of the decoded audio.
 * That is the correct answer when the new tempo needs less silence than the
 * recording carries, and it is only reachable at all because the song start
 * is known.
 */
export function keepSongOnItsAudio(
  before: ChartDocument,
  after: ChartDocument,
): ChartDocument {
  const tick = getSongStartTick(after);
  if (tick == null) return after;

  const songStartAudio = songStartAudioMs(before);
  if (songStartAudio === null) return after;

  const newChart = after.parsedChart;
  const timedNew = buildTimedTempos(newChart.tempos, newChart.resolution);
  const padMs = tickToMs(tick, timedNew, newChart.resolution) - songStartAudio;

  return setAudioAnchor(after, {
    ms: padMs,
    tick: msToTick(padMs, timedNew, newChart.resolution),
  });
}

/**
 * Apply a lead-in plan: shift every event by the difference between the new
 * pad and the doc's current one, install the emitted synctrack, and re-tick
 * (plan 0124 steps 2 and 3).
 *
 * The shift is a difference, not the whole pad: the pad is absolute, so
 * shifting by all of it on a second press would move the chart twice. The
 * anchor is set to `padMs`, never added to, which is what `useShiftedAudio`
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

  // The song now starts a whole number of bars in, by construction: the emit
  // put the opening at ms 0 and the pad is `N * barMs - X`. Recording that
  // tick is what lets the next press count bars instead of guessing.
  // From the plan's OWN emitted signature, not from the doc: the doc still
  // carries the pre-pad song-start tick, and `resolveOpening` would read the
  // meter there — a tick that means something else in this new frame.
  const emitted = plan.newSync.timeSignatures[0];
  const barTicks =
    ((emitted.numerator * 4) / emitted.denominator) * swapped.resolution;
  return setSongStartTick(
    setAudioAnchor(withChart, {ms: plan.padMs, tick: anchorTick}),
    Math.round(plan.bars * barTicks),
  );
}
