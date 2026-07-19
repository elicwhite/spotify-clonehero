/**
 * Timing primitives for in-memory chart edits (plan 0061 §1/§2).
 *
 * `retimeChart` recomputes `msTime`/`msLength` for every event at/after a
 * given tick from the chart's own `tempos` + `resolution`, using the exact
 * arithmetic scan-chart's parser uses (`getTimedTempos` /
 * `setEventMsTimes`), so an in-memory retime produces bit-identical values
 * to a `writeChartFolder` → `parseChartFile` round trip.
 *
 * `makeChartTiming` + `applyEventTiming` are the single-event versions for
 * mutators that insert or move one event and need its derived timing
 * without a full-chart pass.
 *
 * `quantizeBpm` enforces the format-quantization invariant (0061 §2): the
 * chart formats quantize BPM on write (`.chart` to milli-BPM, `.mid` to an
 * integer µs-per-beat), so any BPM stored on the in-memory doc must
 * already be the format-representable value — otherwise every downstream
 * event's ms would drift on write→parse.
 */

import type {ParsedChart} from './types';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Pre-computed tempo table for single-event timing. Build once per
 * mutation batch via `makeChartTiming` and pass to the event-level
 * mutators (`addDrumNote`, `addStarPower`, …) that don't have access to
 * the whole chart.
 */
export interface ChartTiming {
  timedTempos: TimedTempo[];
  resolution: number;
}

/** Minimal shape of a timed event: msTime always, msLength when it has a length. */
interface TimedEvent {
  tick: number;
  msTime: number;
  length?: number;
  msLength?: number;
}

// ---------------------------------------------------------------------------
// BPM format quantization (0061 §2)
// ---------------------------------------------------------------------------

/**
 * Quantize a BPM to the value that survives a write→parse round trip for
 * the given chart format:
 *  - `.chart` stores milli-BPM (`Math.round(bpm * 1000)` on write,
 *    `/ 1000` on parse)
 *  - `.mid` stores an integer µs-per-beat (`Math.round(6e7 / bpm)` on
 *    write, `6e7 / µs` on parse)
 *
 * The returned value is a fixed point of its own round trip: writing and
 * re-parsing it yields the identical number.
 */
export function quantizeBpm(bpm: number, format: 'chart' | 'mid'): number {
  if (format === 'mid') {
    return 6e7 / Math.round(6e7 / bpm);
  }
  return Math.round(bpm * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Tempo table
// ---------------------------------------------------------------------------

/**
 * Tempo table used for lookups. Matches scan-chart's `getTimedTempos`
 * semantics: when the chart has no tempo at tick 0, an implicit 120 BPM
 * entry anchors the table (parsed charts always have a tick-0 tempo, so
 * this only matters for hand-built docs).
 */
function tempoTable(
  tempos: ParsedChart['tempos'],
  resolution: number,
): TimedTempo[] {
  if (tempos.length > 0 && tempos[0].tick === 0) return tempos;
  const table: TimedTempo[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
  for (const t of tempos) table.push(t);
  return table;
}

/**
 * Recompute `msTime` on every tempo event in place, cumulatively from the
 * start of the chart (same recurrence as scan-chart's `getTimedTempos`).
 */
function retimeTempos(tempos: ParsedChart['tempos'], resolution: number): void {
  let prev: TimedTempo = {tick: 0, beatsPerMinute: 120, msTime: 0};
  for (const t of tempos) {
    t.msTime =
      prev.msTime +
      ((t.tick - prev.tick) * 60000) / (prev.beatsPerMinute * resolution);
    prev = t;
  }
}

/** Build a `ChartTiming` from a chart's current tempos + resolution. */
export function makeChartTiming(
  parsedChart: Pick<ParsedChart, 'tempos' | 'resolution'>,
): ChartTiming {
  return {
    timedTempos: tempoTable(parsedChart.tempos, parsedChart.resolution),
    resolution: parsedChart.resolution,
  };
}

// ---------------------------------------------------------------------------
// Event timing
// ---------------------------------------------------------------------------

/** Index of the last tempo whose tick is <= `tick`. */
function tempoIndexAt(timedTempos: TimedTempo[], tick: number): number {
  let index = 0;
  for (let i = 1; i < timedTempos.length; i++) {
    if (timedTempos[i].tick <= tick) index = i;
    else break;
  }
  return index;
}

/**
 * Compute `msTime`/`msLength` for a single event from the tempo table.
 * Uses the exact expressions scan-chart's `setEventMsTimes` uses, so the
 * result matches a parse bit for bit. Events without a `length` get
 * `msLength = 0` (as the parser does).
 */
export function applyEventTiming(event: TimedEvent, timing: ChartTiming): void {
  const {timedTempos, resolution} = timing;
  const startIndex = tempoIndexAt(timedTempos, event.tick);
  const start = timedTempos[startIndex];
  event.msTime =
    start.msTime +
    ((event.tick - start.tick) * 60000) / (start.beatsPerMinute * resolution);
  const len = event.length;
  if (len) {
    const endTick = event.tick + len;
    let endIndex = startIndex;
    while (
      endIndex + 1 < timedTempos.length &&
      timedTempos[endIndex + 1].tick <= endTick
    ) {
      endIndex++;
    }
    const end = timedTempos[endIndex];
    event.msLength =
      end.msTime -
      event.msTime +
      ((endTick - end.tick) * 60000) / (end.beatsPerMinute * resolution);
  } else {
    event.msLength = 0;
  }
}

/**
 * Retime a tick-sorted array of events in place. Events entirely before
 * `fromTick` (including their length span) are left untouched.
 *
 * Mirrors scan-chart's `setEventMsTimes` two-pointer walk (events must be
 * sorted by tick, which every chart-edit mutator maintains).
 */
function retimeEvents(
  events: TimedEvent[],
  timedTempos: TimedTempo[],
  resolution: number,
  fromTick: number,
): void {
  const temposLen = timedTempos.length;
  let tempoIndex = 0;
  for (const event of events) {
    while (
      tempoIndex + 1 < temposLen &&
      timedTempos[tempoIndex + 1].tick <= event.tick
    ) {
      tempoIndex++;
    }
    const len = event.length ?? 0;
    if (event.tick + len < fromTick) continue;
    const start = timedTempos[tempoIndex];
    event.msTime =
      start.msTime +
      ((event.tick - start.tick) * 60000) / (start.beatsPerMinute * resolution);
    if (len) {
      const endTick = event.tick + len;
      let endIndex = tempoIndex;
      while (
        endIndex + 1 < temposLen &&
        timedTempos[endIndex + 1].tick <= endTick
      ) {
        endIndex++;
      }
      const end = timedTempos[endIndex];
      event.msLength =
        end.msTime -
        event.msTime +
        ((endTick - end.tick) * 60000) / (end.beatsPerMinute * resolution);
    } else {
      event.msLength = 0;
    }
  }
}

/** Retime note event groups (nested arrays sharing one tempo pointer). */
function retimeNoteGroups(
  groups: TimedEvent[][],
  timedTempos: TimedTempo[],
  resolution: number,
  fromTick: number,
): void {
  const temposLen = timedTempos.length;
  let tempoIndex = 0;
  for (const group of groups) {
    for (const event of group) {
      while (
        tempoIndex + 1 < temposLen &&
        timedTempos[tempoIndex + 1].tick <= event.tick
      ) {
        tempoIndex++;
      }
      const len = event.length ?? 0;
      if (event.tick + len < fromTick) continue;
      const start = timedTempos[tempoIndex];
      event.msTime =
        start.msTime +
        ((event.tick - start.tick) * 60000) /
          (start.beatsPerMinute * resolution);
      if (len) {
        const endTick = event.tick + len;
        let endIndex = tempoIndex;
        while (
          endIndex + 1 < temposLen &&
          timedTempos[endIndex + 1].tick <= endTick
        ) {
          endIndex++;
        }
        const end = timedTempos[endIndex];
        event.msLength =
          end.msTime -
          event.msTime +
          ((endTick - end.tick) * 60000) / (end.beatsPerMinute * resolution);
      } else {
        event.msLength = 0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// retimeChart
// ---------------------------------------------------------------------------

/**
 * Recompute `msTime`/`msLength` for every event at/after `fromTick`, from
 * the chart's own `tempos` + `resolution`. `fromTick = 0` (the default)
 * is a full retime.
 *
 * `fromTick` is the earliest tick whose *timing* may have changed — after
 * a tempo mutation at tick T, pass T (every event at/after T shifts;
 * events spanning across T get their `msLength` recomputed too). Tempo
 * events themselves are always fully recomputed (their `msTime` is a
 * cumulative recurrence, and recomputing all of them is exact and cheap).
 *
 * Covers: tempos, timeSignatures, sections, endEvents, unrecognized
 * events-track text events, every track's note groups + star power /
 * solo / freestyle / flex / text / versus / animation sections, and vocal
 * phrases (incl. notes + lyrics), shifts, and text events.
 */
export function retimeChart(parsedChart: ParsedChart, fromTick = 0): void {
  const resolution = parsedChart.resolution;
  retimeTempos(parsedChart.tempos, resolution);
  const timedTempos = tempoTable(parsedChart.tempos, resolution);

  const retime = (events: TimedEvent[]) =>
    retimeEvents(events, timedTempos, resolution, fromTick);

  retime(parsedChart.timeSignatures);
  retime(parsedChart.sections);
  retime(parsedChart.endEvents);
  retime(parsedChart.unrecognizedEventsTrackTextEvents);

  for (const track of parsedChart.trackData) {
    retimeNoteGroups(track.noteEventGroups, timedTempos, resolution, fromTick);
    retime(track.starPowerSections);
    retime(track.rejectedStarPowerSections);
    retime(track.soloSections);
    retime(track.flexLanes);
    retime(track.drumFreestyleSections);
    retime(track.textEvents);
    retime(track.versusPhrases);
    retime(track.animations);
  }

  const vocalTracks = parsedChart.vocalTracks;
  if (vocalTracks) {
    retime(vocalTracks.rangeShifts);
    retime(vocalTracks.lyricShifts);
    for (const part of Object.values(vocalTracks.parts)) {
      for (const phrases of [part.notePhrases, part.staticLyricPhrases]) {
        retime(phrases);
        for (const phrase of phrases) {
          retime(phrase.notes);
          retime(phrase.lyrics);
        }
      }
      retime(part.starPowerSections);
      retime(part.rangeShifts);
      retime(part.lyricShifts);
      retime(part.textEvents);
    }
  }
}
