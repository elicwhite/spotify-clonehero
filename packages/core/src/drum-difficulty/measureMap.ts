/**
 * Tick-based measure map — a faithful port of HOPCAT's `MeasureMap` / `mbt()`
 * / `build_measures` (`reduce_port.py`, itself C3toolbox's `measures_array`
 * + `mbt()`).
 *
 * This is later a parity-tested component: it must reproduce the Python
 * `mbt()` output tuple-for-tuple, so the semantics are ported exactly rather
 * than reusing `bar-derivation.ts`'s beat grid (whose downbeat model is
 * close but not bit-identical — e.g. it re-anchors per region and does not
 * expose the `(measure, beat, tickInBeat, ticksSinceMeasureStart)` tuple
 * `remove_notes`/`unflip_discobeat` read). Per the plan's "parity beats
 * reuse" guidance for the reducer-critical measure math.
 *
 * Ticks are whatever resolution the caller builds the map in. HOPCAT builds
 * it at 480 TQN (`CORRECT_TQN`); the adapter rescales the source chart's
 * ticks to 480 before calling here (see `adapter/hopcat.ts`).
 */

/** Round half to even (banker's rounding), matching Python's `round()`. */
function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // Exactly .5 — round to the even neighbor.
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `bisect.bisect_right(arr, x)` — index one past the last element <= x. */
function bisectRight(arr: readonly number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < arr[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export interface Measure {
  number: number;
  startTick: number;
  denominator: number;
  numerator: number;
  /** "ticks per beat-unit" = `ticksPerBeat * 4 / denominator`. */
  beatTicks: number;
}

/**
 * `(measure, beat, tickInBeat, ticksSinceMeasureStart)` — the `mbt()` tuple.
 * `measure` and `beat` are 1-based; `ticksSinceMeasureStart` is the value
 * `remove_notes`/`unflip_discobeat` actually grid-check against.
 */
export interface Mbt {
  measure: number;
  beat: number;
  tickInBeat: number;
  ticksSinceMeasureStart: number;
}

export class MeasureMap {
  readonly measures: Measure[];
  private readonly starts: number[];

  constructor(measures: Measure[]) {
    if (measures.length === 0) {
      throw new Error('MeasureMap: need at least one measure');
    }
    this.measures = measures;
    this.starts = measures.map(m => m.startTick);
  }

  /**
   * Resolve a tick to its measure/beat position. Mirrors `mbt()`: the last
   * measure whose start tick <= `position`, re-using the final measure's grid
   * indefinitely for positions past the last generated bar.
   */
  mbt(position: number): Mbt {
    let idx = bisectRight(this.starts, position) - 1;
    if (idx < 0) idx = 0;
    const meas = this.measures[idx];
    const rel = position - meas.startTick;
    const beat = Math.floor(rel / meas.beatTicks) + 1;
    const tickInBeat = Math.trunc(rel - (beat - 1) * meas.beatTicks);
    return {
      measure: meas.number,
      beat,
      tickInBeat,
      ticksSinceMeasureStart: rel,
    };
  }

  measureOf(position: number): number {
    return this.mbt(position).measure;
  }
}

/**
 * Build a `MeasureMap` from `(tick, numerator, denominator)` time-signature
 * events plus the file's `ticksPerBeat`. Semantic equivalent of
 * `build_measures`: walks each TS segment emitting one measure per bar; a
 * missing/late first event implies a leading 4/4, and the trailing segment
 * runs one bar past `endTick`.
 *
 * If a real TS change isn't bar-aligned this drifts (matching the Python
 * port's documented AMBIGUITY #3); RB-convention charts place TS changes on
 * bar lines, so this is not expected to matter.
 */
export function buildMeasures(
  tsEvents: readonly [tick: number, numerator: number, denominator: number][],
  ticksPerBeat: number,
  endTick: number,
): MeasureMap {
  let events = tsEvents.slice();
  if (events.length === 0 || events[0][0] !== 0) {
    events = [[0, 4, 4], ...events];
  }
  events = events.slice().sort((a, b) => a[0] - b[0]);

  const measures: Measure[] = [];
  let m = 0;
  for (let i = 0; i < events.length; i++) {
    const [startTick, num, den] = events[i];
    const beatTicks = (ticksPerBeat * 4) / den;
    const barTicks = beatTicks * num;
    const segmentEnd =
      i + 1 < events.length
        ? events[i + 1][0]
        : Math.max(endTick, startTick) + barTicks;
    let pos = startTick;
    while (pos < segmentEnd) {
      m += 1;
      measures.push({
        number: m,
        startTick: pyRound(pos),
        denominator: den,
        numerator: num,
        beatTicks,
      });
      pos += barTicks;
    }
  }
  return new MeasureMap(measures);
}
