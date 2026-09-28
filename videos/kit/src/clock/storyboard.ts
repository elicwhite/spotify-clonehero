/**
 * A film's storyboard: its scene windows in film frames, most of them
 * starting on a bar line of the music.
 *
 * This module has no runtime imports, so Node scripts (recorder specs that
 * place a take inside a scene) load it as the film does.
 *
 * ```ts
 * export const board = defineStoryboard([
 *   {id: 'title', from: 0, to: 375, bar: 0},
 *   {id: 'tempo', from: 375, to: 750, bar: 5},
 *   {id: 'end', from: 730, to: 900, bar: null}, // starts before its bar, under the last cut
 * ]);
 * const beat = board.sceneBeat(tl.frameOfBeat, 'tempo'); // beat(1, 2): bar 1, beat 2 of the scene
 * ```
 */

export interface StoryboardScene {
  id: string;
  /** First film frame. */
  from: number;
  /** First film frame after the scene. */
  to: number;
  /** The video bar the scene starts on, or null for a scene that does not start on a bar line. */
  bar: number | null;
}

/** A timeline's `frameOfBeat`: the film's `tl.frameOfBeat`, or the same grid in Node. */
export type FrameOfBeat = (bar: number, beat?: number) => number;

/** Frame of beat `beat` of bar `bar`, both counted from 0 at a scene's first downbeat. */
export type SceneBeat = (bar: number, beat?: number) => number;

export interface Storyboard<S extends StoryboardScene> {
  scenes: readonly S[];
  /** The film's length: frames from frame 0 to the end of its last scene. */
  durationInFrames: number;
  scene<I extends S['id']>(id: I): Extract<S, {id: I}>;
  /** Props for `<SceneWindow>`: `<SceneWindow {...board.window('tempo')}>`. */
  window(id: S['id']): {from: number; durationInFrames: number; name: string};
  /** The video bar a scene starts on: its bar-counted cues count from it. Throws for a scene off the bar grid. */
  sceneBar(id: S['id']): number;
  /** A scene's `SceneBeat`, from a timeline's `frameOfBeat`. */
  sceneBeat(frameOfBeat: FrameOfBeat, id: S['id']): SceneBeat;
  /** One message per bar-aligned scene whose `from` is not its bar's frame. */
  checkStoryboard(frameOfBar: (bar: number) => number): string[];
}

export const defineStoryboard = <const S extends StoryboardScene>(
  scenes: readonly S[],
): Storyboard<S> => {
  if (scenes.length === 0) throw new Error('[storyboard] no scenes');
  const byId = new Map<string, S>();
  for (const s of scenes) {
    if (byId.has(s.id)) throw new Error(`[storyboard] two scenes are ${s.id}`);
    if (!Number.isInteger(s.from) || !Number.isInteger(s.to) || s.from < 0) {
      throw new Error(`[storyboard] ${s.id} needs whole frames from >= 0`);
    }
    if (s.to <= s.from)
      throw new Error(`[storyboard] ${s.id} ends before it starts`);
    if (s.bar !== null && !Number.isInteger(s.bar)) {
      throw new Error(`[storyboard] ${s.id} starts on a fractional bar`);
    }
    byId.set(s.id, s);
  }
  const scene = <I extends S['id']>(id: I): Extract<S, {id: I}> => {
    const s = byId.get(id);
    if (!s) throw new Error(`[storyboard] no scene ${id}`);
    return s as Extract<S, {id: I}>;
  };
  const sceneBar = (id: S['id']): number => {
    const {bar} = scene(id);
    if (bar === null)
      throw new Error(`[storyboard] ${id} does not start on a bar`);
    return bar;
  };
  return {
    scenes,
    durationInFrames: Math.max(...scenes.map(s => s.to)),
    scene,
    window: id => {
      const s = scene(id);
      return {from: s.from, durationInFrames: s.to - s.from, name: s.id};
    },
    sceneBar,
    sceneBeat: (frameOfBeat, id) => {
      const first = sceneBar(id);
      return (bar, beat = 0) => frameOfBeat(first + bar, beat);
    },
    checkStoryboard: frameOfBar =>
      scenes.flatMap(s => {
        if (s.bar === null) return [];
        const expected = frameOfBar(s.bar);
        return expected === s.from
          ? []
          : [`${s.id} starts at ${s.from}, but bar ${s.bar} is at ${expected}`];
      }),
  };
};
