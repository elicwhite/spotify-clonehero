/**
 * Events and pulses over film frames. An event list is a sorted array of
 * frames (every `TimelineApi` frame list is one); a pulse is a 0..1 value
 * that reacts to the events. Pure.
 */
import {lowerBound} from '../motion/sorted';

/** Frames since the latest event at or before `frame` (Infinity if none). */
export const framesSince = (
  sortedFrames: readonly number[],
  frame: number,
): number => {
  const i = lowerBound(sortedFrames, frame + 1e-9) - 1;
  return i < 0 ? Infinity : frame - (sortedFrames[i] as number);
};

/** Frames until the next event strictly after `frame` (Infinity if none). */
export const framesUntil = (
  sortedFrames: readonly number[],
  frame: number,
): number => {
  const i = lowerBound(sortedFrames, frame + 1e-9);
  return i >= sortedFrames.length
    ? Infinity
    : (sortedFrames[i] as number) - frame;
};

/** Index of the latest event at or before `frame` (-1 if none). */
export const lastEventIndex = (
  sortedFrames: readonly number[],
  frame: number,
): number => lowerBound(sortedFrames, frame + 1e-9) - 1;

/** First event at or after `frame` (null if none): `nextEvent(tl.hitFrames.snare, stop)` is the slam after a stop. */
export const nextEvent = (
  sortedFrames: readonly number[],
  frame: number,
): number | null => {
  const i = lowerBound(sortedFrames, frame);
  return i < sortedFrames.length ? (sortedFrames[i] as number) : null;
};

/** Latest event at or before `frame` (null if none). */
export const prevEvent = (
  sortedFrames: readonly number[],
  frame: number,
): number | null => {
  const i = lastEventIndex(sortedFrames, frame);
  return i >= 0 ? (sortedFrames[i] as number) : null;
};

/**
 * Start frames that make fast reveals LAND on the given frames: an expo-out
 * entrance reads as arrived a few frames after it starts, so start it `lead`
 * frames early. `enterAt={landOn([tl.frameOfBeat(1, 1)], 3)}`.
 */
export const landOn = (frames: readonly number[], lead: number): number[] =>
  frames.map(f => f - lead);

/**
 * 1 on the event frame, decaying to exactly 0 after `decayFrames`:
 * `(1 - since / decay) ^ power`. Power 2 reads as a punch, 1 is linear, 4 is
 * a sharp tick.
 */
export const decayPulse = (
  since: number,
  decayFrames: number,
  power = 2,
): number => {
  if (!(since >= 0) || since >= decayFrames) return 0;
  return Math.pow(1 - since / decayFrames, power);
};

/** A pulse from the latest of `sortedFrames`. */
export const pulseAt = (
  sortedFrames: readonly number[],
  frame: number,
  decayFrames: number,
  power = 2,
): number => decayPulse(framesSince(sortedFrames, frame), decayFrames, power);

/**
 * A pulse that rises BEFORE an event and peaks on it: 0 at `leadFrames`
 * before, 1 on it. For pulling back a beat before a big downbeat.
 */
export const anticipation = (
  sortedFrames: readonly number[],
  frame: number,
  leadFrames: number,
  power = 2,
): number => {
  const until = framesUntil(sortedFrames, frame);
  if (until > leadFrames) return 0;
  return Math.pow(1 - until / leadFrames, power);
};
