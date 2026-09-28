/**
 * Keyframes and envelopes over (fractional) frames. Every keyed sequence
 * holds its first value before its first key and its last value after its
 * last key, and eases each move with the easing of the key it arrives at.
 */
import {inOutCubic, type EasingFn} from './easing';
import {clamp01, mix, progress} from './math';

/** The segment `frame` falls in: the index of the key it moves toward, and 0..1 progress to it. */
const segmentAt = (
  frame: number,
  count: number,
  atOf: (i: number) => number,
): {i: number; t: number} => {
  // Keys are few: a linear scan beats a binary search.
  let i = 1;
  while (i < count - 1 && frame > atOf(i)) i++;
  const from = atOf(i - 1);
  const span = atOf(i) - from;
  return {i, t: span <= 0 ? 1 : clamp01((frame - from) / span)};
};

/** One key of a keyed sequence: its film frame, its value, and the easing of the move arriving at it. */
export interface Keyframe<T> {
  at: number;
  value: T;
  ease?: EasingFn;
}

/**
 * A keyed sequence of any value at `frame`: between two keys,
 * `mix(a, b, e)` with `e` the eased progress from `a` to `b` (the arriving
 * key's easing, else `defaultEase`). Keys must be in frame order.
 *
 * ```ts
 * const pose = keyed(frame, [{at: 0, value: rest}, {at: 90, value: close, ease: glide}], mixPose);
 * ```
 */
export const keyed = <T>(
  frame: number,
  keys: readonly Keyframe<T>[],
  mixValues: (a: T, b: T, t: number) => T,
  defaultEase: EasingFn = inOutCubic,
): T => {
  const first = keys[0];
  if (!first) throw new Error('[motion] keyed needs at least one key');
  if (keys.length === 1 || frame <= first.at) return first.value;
  const last = keys[keys.length - 1] as Keyframe<T>;
  if (frame >= last.at) return last.value;
  const {i, t} = segmentAt(
    frame,
    keys.length,
    k => (keys[k] as Keyframe<T>).at,
  );
  const a = keys[i - 1] as Keyframe<T>;
  const b = keys[i] as Keyframe<T>;
  return mixValues(a.value, b.value, (b.ease ?? defaultEase)(t));
};

/** `[frame, value, easing?]`: the easing shapes the segment ARRIVING at this key. */
export type Key = readonly [frame: number, value: number, easing?: EasingFn];

/**
 * Number keyframes, the everyday case of `keyed` (default easing in-out
 * cubic). 0 with no keys.
 *
 * ```ts
 * const y = kf(frame, [[300, 80], [330, 0, ease.enter], [420, 0], [436, -60, ease.exit]]);
 * ```
 */
export const kf = (frame: number, keys: readonly Key[]): number => {
  const first = keys[0];
  if (!first) return 0;
  if (keys.length === 1 || frame <= first[0]) return first[1];
  const last = keys[keys.length - 1] as Key;
  if (frame >= last[0]) return last[1];
  const {i, t} = segmentAt(frame, keys.length, k => (keys[k] as Key)[0]);
  const a = keys[i - 1] as Key;
  const b = keys[i] as Key;
  return mix(a[1], b[1], (b[2] ?? inOutCubic)(t));
};

/**
 * An in -> hold -> out envelope: 0 before `inAt`, eases to 1 over `inDur`
 * frames, holds, then eases back to 0 over `outDur` frames from `outAt`
 * (the brand's `ease.enter` and `ease.exit` are the usual pair).
 */
export const envelope = (
  frame: number,
  inAt: number,
  inDur: number,
  outAt: number,
  outDur: number,
  easeIn: EasingFn,
  easeOut: EasingFn,
): number => {
  if (frame < inAt) return 0;
  if (frame < inAt + inDur) return easeIn(progress(frame, inAt, inDur));
  if (frame < outAt) return 1;
  return 1 - easeOut(progress(frame, outAt, outDur));
};
