/**
 * The timeline API every scene reads musical time from. Pure: the React
 * provider builds it once per timeline, and Node scripts can build the same
 * one. Frames are the timeline's frames (`Math.round(t * fps)`).
 */
import {lowerBound, sortedUnique} from '../motion/sorted';
import {beatGrid, type BeatGrid} from './beatGrid';
import type {
  DrumKit,
  DrumLane,
  DrumNote,
  Envelopes,
  GuitarNote,
  HitKind,
  Meta,
  Peaks,
  Syllable,
  Timeline,
} from './contract';

type OneOrMany<T> = T | readonly T[];

/** Filter for `drumFrames`: fields to match (arrays mean any of), or a predicate. */
export type DrumFilter =
  | {
      kit?: OneOrMany<DrumKit>;
      lane?: OneOrMany<DrumLane>;
      cymbal?: boolean;
      accent?: boolean;
      ghost?: boolean;
      doubleKick?: boolean;
    }
  | ((n: DrumNote) => boolean);

export interface TimelineApi extends BeatGrid {
  timeline: Timeline;
  meta: Meta;
  fps: number;
  /** Null when none were given. */
  peaks: Peaks | null;
  envelopes: Envelopes | null;
  /** Hit times as frames (nearest frame), sorted and unique. */
  hitFrames: Record<HitKind, number[]>;
  /** Downbeats that really hit: a kick or crash within `HIT_TOLERANCE_SEC` of them. */
  downbeatHitFrames: number[];
  /**
   * Stops: downbeats where the band chokes (no kick or crash on it, and the
   * mix envelope just after falls below 45% of just before). Empty without
   * envelopes. A downbeat without a drum note is not necessarily a stop: a
   * band often pushes an eighth early, which `tuttiFrames()` finds.
   */
  stopFrames: number[];
  /**
   * Frames of drum notes matching a filter, sorted and unique:
   * `drumFrames({kit: 'crash'})`, `drumFrames({accent: true})`,
   * `drumFrames({lane: ['red', 'yellow'], cymbal: false})`, or a predicate.
   */
  drumFrames(filter?: DrumFilter): number[];
  /** Frames of sung syllable onsets. */
  syllableFrames: number[];
  /**
   * Band hits: frames where a drum note and a guitar note land together
   * (within `toleranceSec`, default `TUTTI_TOLERANCE_SEC`). Pushes and
   * stabs, not the groove.
   */
  tuttiFrames(toleranceSec?: number): number[];
  /** Notes starting in [t0, t1) video seconds (binary search, cheap per frame). */
  drumsBetween(t0: number, t1: number): DrumNote[];
  guitarBetween(t0: number, t1: number): GuitarNote[];
  syllablesBetween(t0: number, t1: number): Syllable[];
  /** A stem's envelope at a (fractional) frame, linearly interpolated. Throws without that envelope. */
  envelopeAt(stem: string, frame: number): number;
}

/** How near a kick or crash must be to a downbeat to count as hitting it, seconds. */
export const HIT_TOLERANCE_SEC = 0.035;
/** How near a drum and a guitar note must land to count as one band hit, seconds. */
export const TUTTI_TOLERANCE_SEC = 0.02;
/** The stop check compares the mix over this long before and after a downbeat, seconds... */
const STOP_WINDOW_SEC = 0.23;
/** ...skipping this much either side of it. */
const STOP_GAP_SEC = 0.035;

const matchOne = <T>(v: T, want: OneOrMany<T> | undefined): boolean =>
  want === undefined
    ? true
    : Array.isArray(want)
      ? (want as readonly T[]).includes(v)
      : v === want;

const drumMatcher = (
  filter: DrumFilter | undefined,
): ((n: DrumNote) => boolean) => {
  if (!filter) return () => true;
  if (typeof filter === 'function') return filter;
  return n =>
    matchOne(n.kit, filter.kit) &&
    matchOne(n.lane, filter.lane) &&
    (filter.cymbal === undefined || n.cymbal === filter.cymbal) &&
    (filter.accent === undefined || n.accent === filter.accent) &&
    (filter.ghost === undefined || n.ghost === filter.ghost) &&
    (filter.doubleKick === undefined || n.doubleKick === filter.doubleKick);
};

/** True if some value of sorted `frames` is within `tol` of `f`. */
const near = (frames: readonly number[], f: number, tol: number): boolean => {
  const i = lowerBound(frames, f - tol);
  return i < frames.length && (frames[i] as number) <= f + tol;
};

const byTime = <T extends {t: number}>(items: readonly T[]) => {
  const times = items.map(i => i.t);
  return (t0: number, t1: number): T[] =>
    items.slice(lowerBound(times, t0), lowerBound(times, t1));
};

export const buildTimelineApi = (
  timeline: Timeline,
  {
    peaks = null,
    envelopes = null,
  }: {peaks?: Peaks | null; envelopes?: Envelopes | null} = {},
): TimelineApi => {
  const fps = timeline.fps;
  const grid = beatGrid(timeline);
  const toFrame = (t: number) => Math.round(t * fps);
  const framesOf = (times: readonly number[]) =>
    sortedUnique(times.map(toFrame));

  const envelopeAt = (stem: string, frame: number): number => {
    if (!envelopes) {
      throw new Error(
        `[timeline] envelopeAt('${stem}') needs envelopes: pass them to the TimelineProvider`,
      );
    }
    const curve = envelopes.stems[stem];
    if (!curve) {
      throw new Error(
        `[timeline] no '${stem}' envelope; the stems are ${Object.keys(envelopes.stems).join(', ')}`,
      );
    }
    if (curve.length === 0) return 0;
    const x = (frame / fps) * envelopes.fps;
    const i = Math.floor(x);
    if (i < 0) return curve[0] as number;
    if (i >= curve.length - 1) return curve[curve.length - 1] as number;
    const f = x - i;
    return (curve[i] as number) * (1 - f) + (curve[i + 1] as number) * f;
  };

  const drums = [...timeline.notes.drums].sort((a, b) => a.t - b.t);
  const guitar = [...timeline.notes.guitar].sort((a, b) => a.t - b.t);
  const syllables = [...timeline.vocals.syllables].sort((a, b) => a.t - b.t);

  const drumFrames = (filter?: DrumFilter) =>
    framesOf(drums.filter(drumMatcher(filter)).map(n => n.t));
  const allDrumFrames = drumFrames();
  const allGuitarFrames = framesOf(guitar.map(n => n.t));
  const bigHitFrames = drumFrames({kit: ['kick', 'crash']});
  const downbeatFrames = grid.beats.filter(b => b.downbeat).map(b => b.frame);

  /** A tolerance in seconds as whole frames, at least one. */
  const toleranceFrames = (sec: number) => Math.max(1, Math.round(sec * fps));
  const hitTol = toleranceFrames(HIT_TOLERANCE_SEC);
  const stopWindow = toleranceFrames(STOP_WINDOW_SEC);
  const stopGap = toleranceFrames(STOP_GAP_SEC);
  const meanMix = (a: number, b: number) => {
    let sum = 0;
    for (let k = a; k <= b; k++) sum += envelopeAt('mix', k);
    return sum / (b - a + 1);
  };

  return {
    ...grid,
    timeline,
    meta: timeline.meta,
    fps,
    peaks,
    envelopes,
    hitFrames: {
      kick: framesOf(timeline.hits.kick),
      snare: framesOf(timeline.hits.snare),
      crash: framesOf(timeline.hits.crash),
      any: framesOf(timeline.hits.any),
    },
    downbeatHitFrames: downbeatFrames.filter(f =>
      near(bigHitFrames, f, hitTol),
    ),
    stopFrames: envelopes
      ? downbeatFrames.filter(f => {
          if (near(bigHitFrames, f, hitTol)) return false;
          const before = meanMix(f - stopWindow, f - stopGap);
          return (
            before > 0.02 &&
            meanMix(f + stopGap, f + stopWindow) < 0.45 * before
          );
        })
      : [],
    drumFrames,
    syllableFrames: framesOf(syllables.map(s => s.t)),
    tuttiFrames: (toleranceSec = TUTTI_TOLERANCE_SEC) =>
      allDrumFrames.filter(f =>
        near(allGuitarFrames, f, toleranceFrames(toleranceSec)),
      ),
    drumsBetween: byTime(drums),
    guitarBetween: byTime(guitar),
    syllablesBetween: byTime(syllables),
    envelopeAt,
  };
};
