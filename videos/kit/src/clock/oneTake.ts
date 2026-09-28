/**
 * One take: a film shot as one continuous move, cut into scenes only for
 * editing. Each scene starts where the one before it ends, so the starts are
 * derived from the durations and never typed. The result is a storyboard
 * like any other (its scenes are off the bar grid), so every scene renders
 * the same film in its own window (`<SceneWindow {...take.window(id)}>`) and
 * the boundaries are invisible.
 *
 * No runtime imports but the storyboard's, which has none.
 */
import {defineStoryboard, type Storyboard} from './storyboard';

/** Scenes laid end to end from frame 0, as a storyboard. */
export const oneTake = <const S extends {id: string; durationInFrames: number}>(
  scenes: readonly S[],
): Storyboard<S & {from: number; to: number; bar: null}> => {
  let from = 0;
  return defineStoryboard(
    scenes.map(s => {
      if (!Number.isInteger(s.durationInFrames) || s.durationInFrames <= 0) {
        throw new Error(`[oneTake] ${s.id} needs a whole, positive duration`);
      }
      const placed = {...s, from, to: from + s.durationInFrames, bar: null};
      from = placed.to;
      return placed;
    }),
  );
};
