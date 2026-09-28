/**
 * Bar and beat to film time, from a timeline's beat list. Pure: the film
 * reads it through `TimelineApi`, and Node scripts (the recorder, audits)
 * import it directly, so a recording's interaction frames and the film's
 * cues come from the same math.
 */
import {lowerBound} from '../motion/sorted';
import type {Beat, Timeline} from './contract';

export interface BeatGrid {
  /** The timeline's beats, sorted by time. */
  beats: Beat[];
  /**
   * Nearest frame of bar/beat. `beat` may be fractional (2.5 = the "and" of
   * beat 3). Past either end of the beat list it extrapolates at the tempo.
   */
  frameOfBeat(bar: number, beat?: number): number;
  /** `frameOfBeat` unrounded, for placing things on continuous time. */
  exactFrameOfBeat(bar: number, beat?: number): number;
  /** Video seconds of bar/beat. */
  timeOfBeat(bar: number, beat?: number): number;
  /** The latest listed beat at or before `frame` (null before the first). */
  beatAt(frame: number): Beat | null;
}

export const beatGrid = (
  timeline: Pick<Timeline, 'fps' | 'beats' | 'tempo'>,
): BeatGrid => {
  const fps = timeline.fps;
  const beats = [...timeline.beats].sort((a, b) => a.t - b.t);
  const first = beats[0];
  const last = beats[beats.length - 1];
  if (!first || !last) throw new Error('[beatGrid] the timeline has no beats');
  const beatSec = timeline.tempo.beatSec;
  const beatsPerBar = Math.max(
    1,
    Math.round(timeline.tempo.barSec / timeline.tempo.beatSec),
  );
  const firstBeatOfBar = new Map<number, number>();
  beats.forEach((b, i) => {
    if (!firstBeatOfBar.has(b.bar)) firstBeatOfBar.set(b.bar, i);
  });

  /**
   * Fractional index into `beats` for bar/beat: counted from the bar's first
   * listed beat, or, for a bar the list does not reach, from the nearer end
   * of the list at the tempo's beats per bar.
   */
  const beatIndexOf = (bar: number, beat: number): number => {
    const start = firstBeatOfBar.get(bar);
    if (start !== undefined) return start + beat - (beats[start] as Beat).beat;
    const anchorIndex = bar > last.bar ? beats.length - 1 : 0;
    const anchor = beats[anchorIndex] as Beat;
    return anchorIndex + (bar - anchor.bar) * beatsPerBar + beat - anchor.beat;
  };
  const timeOfIndex = (x: number): number => {
    if (x <= 0) return first.t + x * beatSec;
    if (x >= beats.length - 1) {
      return last.t + (x - (beats.length - 1)) * beatSec;
    }
    const i = Math.floor(x);
    const a = beats[i] as Beat;
    const b = beats[i + 1] as Beat;
    return a.t + (x - i) * (b.t - a.t);
  };
  const timeOfBeat = (bar: number, beat = 0) =>
    timeOfIndex(beatIndexOf(bar, beat));
  const beatFrames = beats.map(b => b.frame);

  return {
    beats,
    frameOfBeat: (bar, beat = 0) => {
      const x = beatIndexOf(bar, beat);
      if (Number.isInteger(x) && x >= 0 && x < beats.length) {
        return (beats[x] as Beat).frame;
      }
      return Math.round(timeOfIndex(x) * fps);
    },
    exactFrameOfBeat: (bar, beat = 0) => timeOfBeat(bar, beat) * fps,
    timeOfBeat,
    beatAt: frame => beats[lowerBound(beatFrames, frame + 1e-9) - 1] ?? null,
  };
};
