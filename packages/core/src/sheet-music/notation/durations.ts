/**
 * Pure written-duration math: naming fractions of a whole note, splitting
 * spans into metrically aligned chunks, and re-grouping runs of rests.
 * No chart or VexFlow dependencies.
 */

import {Note} from './types';

export const REST_KEY = 'b/4';

const BASE_DURATIONS: Array<[number, string]> = [
  [1, 'w'],
  [1 / 2, 'h'],
  [1 / 4, 'q'],
  [1 / 8, '8'],
  [1 / 16, '16'],
  [1 / 32, '32'],
  [1 / 64, '64'],
];
// Note/rest value sizes (in grid slots) we are willing to merge into a single
// written duration, largest first.
const CHUNK_SIZES = [16, 12, 8, 6, 4, 3, 2, 1];

function approxEqual(a: number, b: number) {
  return Math.abs(a - b) < Math.max(a, b) * 1e-9;
}

/**
 * Express a fraction of a whole note as a single written duration, if
 * possible: either a plain binary value or a single-dotted one.
 */
export function namedDuration(
  fraction: number,
): {duration: string; dots: number} | null {
  const match = BASE_DURATIONS.find(
    ([base]) =>
      approxEqual(fraction, base) || approxEqual(fraction, base * 1.5),
  );

  if (!match) {
    return null;
  }

  return {
    duration: match[1],
    dots: approxEqual(fraction, match[0]) ? 0 : 1,
  };
}

function isPowerOfTwo(value: number) {
  return Number.isInteger(Math.log2(value));
}

/**
 * The slot index multiple a chunk of the given size must start on. Binary
 * chunks sit on multiples of their own size, dotted chunks (3·2^k slots) on
 * multiples of 2^(k+1) — e.g. a dotted eighth among 16ths can start on the
 * beat or on the "and", but not on an off 16th.
 */
function chunkAlignment(size: number) {
  return isPowerOfTwo(size) ? size : (size / 3) * 2;
}

/**
 * Greedily split `span` grid slots starting at `startSlot` into the fewest
 * metrically aligned written durations. `slotFraction` is the written value
 * of one slot as a fraction of a whole note.
 */
export function chunkSpan(
  startSlot: number,
  span: number,
  slotFraction: number,
  allowDotted: boolean,
): number[] {
  const fits = (candidate: number, position: number, remaining: number) => {
    if (candidate > remaining || position % chunkAlignment(candidate)) {
      return false;
    }

    const named = namedDuration(candidate * slotFraction);

    return named !== null && (allowDotted || named.dots === 0);
  };
  const chunks: number[] = [];
  let position = startSlot;
  let remaining = span;

  while (remaining > 0) {
    const currentPosition = position;
    const currentRemaining = remaining;
    const size =
      CHUNK_SIZES.find(candidate =>
        fits(candidate, currentPosition, currentRemaining),
      ) ?? 1;

    chunks.push(size);
    position += size;
    remaining -= size;
  }

  return chunks;
}

export function makeRest(tick: number, duration: string, dots: number): Note {
  return {
    notes: [REST_KEY],
    noteIds: [null],
    duration,
    dots,
    isRest: true,
    tick,
    ms: 0,
  };
}

interface RestValue {
  ticks: number;
  duration: string;
  dots: number;
  align: number; // the offset multiple this value may start on
}

// Rest durations largest-first, plain and single-dotted, for re-grouping a run
// of consecutive rests. A dotted value must start on a multiple of twice its
// base (a dotted quarter on a beat or the "and", not an off-beat).
function restValues(ppq: number): RestValue[] {
  const whole = ppq * 4;
  const bases: Array<[number, string]> = [
    [whole, 'w'],
    [whole / 2, 'h'],
    [whole / 4, 'q'],
    [whole / 8, '8'],
    [whole / 16, '16'],
    [whole / 32, '32'],
    [whole / 64, '64'],
  ];
  const values: RestValue[] = [];

  bases.forEach(([ticks, duration]) => {
    values.push({ticks, duration, dots: 0, align: ticks});
    values.push({ticks: ticks * 1.5, duration, dots: 1, align: ticks * 2});
  });

  return values.sort((a, b) => b.ticks - a.ticks);
}

/**
 * Fill `[spanStart, spanEnd)` of silence with the fewest metrically legal rests.
 * Each rest must align to its own grid, and (in meters with an even number of
 * beats) may not cross the measure midpoint unless it starts at the barline —
 * so beats 2–3 of 4/4 stay two quarter rests rather than a half rest that hides
 * the downbeat of beat 3.
 */
function fillRestSpan(
  spanStart: number,
  spanEnd: number,
  measureStart: number,
  measureTicks: number,
  values: RestValue[],
  guardMid: boolean,
): Note[] {
  const mid = measureStart + measureTicks / 2;
  const out: Note[] = [];
  let pos = spanStart;
  let safety = 0;

  while (pos < spanEnd - 1e-6 && safety < 128) {
    safety += 1;

    const start = pos;
    const remaining = spanEnd - start;
    const offset = start - measureStart;
    const choice =
      values.find(value => {
        if (value.ticks > remaining + 1e-6) {
          return false;
        }

        const m = offset % value.align;

        if (m > 1e-6 && value.align - m > 1e-6) {
          return false;
        }

        if (
          guardMid &&
          start < mid - 1e-6 &&
          start + value.ticks > mid + 1e-6 &&
          Math.abs(start - measureStart) > 1e-6
        ) {
          return false;
        }

        return true;
      }) ?? values[values.length - 1];

    out.push(makeRest(Math.round(pos), choice.duration, choice.dots));
    pos += choice.ticks;
  }

  return out;
}

/**
 * Re-group each maximal run of plain rests in a measure so consecutive rests
 * built by different parts of the pipeline (a silent beat next to a beat's
 * leading rest) combine into the fewest legal values. Rests that belong to a
 * tuplet are left untouched.
 */
export function mergeMeasureRests(
  notes: Note[],
  measureStart: number,
  measureTicks: number,
  ppq: number,
  guardMid: boolean,
): Note[] {
  const values = restValues(ppq);
  const out: Note[] = [];
  let i = 0;

  while (i < notes.length) {
    const note = notes[i];

    if (note.isRest && note.tupletId === undefined) {
      let j = i;

      while (
        j < notes.length &&
        notes[j].isRest &&
        notes[j].tupletId === undefined
      ) {
        j += 1;
      }

      const spanEnd =
        j < notes.length ? notes[j].tick : measureStart + measureTicks;

      out.push(
        ...fillRestSpan(
          note.tick,
          spanEnd,
          measureStart,
          measureTicks,
          values,
          guardMid,
        ),
      );
      i = j;
    } else {
      out.push(note);
      i += 1;
    }
  }

  return out;
}
