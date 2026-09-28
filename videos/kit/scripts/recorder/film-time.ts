/**
 * Film time and song time for a take, from a film's timeline.json, with the
 * kit's own math: src/music/songTime.ts maps film time to song time (each
 * timeline segment plays one stretch of the song, so a take that crosses a
 * splice seeks there exactly as the soundtrack cuts), src/music/beatGrid.ts
 * places bars and beats, and the film's storyboard (src/clock's
 * `defineStoryboard`) says where each scene is. A take and the film cannot
 * disagree about which song second a frame shows or where a beat falls.
 */
import fs from 'node:fs';
import {moduleExports} from '../lib/cli';
import type {
  SceneBeat,
  Storyboard,
  StoryboardScene,
} from '../../src/clock/storyboard';
import {toFrames} from '../../src/format/format';
import {beatGrid} from '../../src/music/beatGrid';
import type {Segment} from '../../src/music/contract';
import {
  segmentIndexAt,
  songTimeAt,
  videoTimeOfSong,
} from '../../src/music/songTime';
import {assertTimeline} from '../../src/music/validate';

/** How long a take records on each side of its scene, by default: room for the cuts and crossfades into and out of it. */
export const DEFAULT_HANDLE_SEC = 0.5;

/** What placing a take needs of a film's storyboard. */
export type TakeStoryboard = Pick<
  Storyboard<StoryboardScene>,
  'scene' | 'sceneBar' | 'sceneBeat'
>;

/**
 * Load a film's storyboard module: its default export, or its `storyboard`
 * or `board` export (the result of `defineStoryboard`).
 */
export const loadStoryboard = async (file: string): Promise<TakeStoryboard> => {
  const mod = await moduleExports(file);
  const board = (mod.default ?? mod.storyboard ?? mod.board) as
    | Partial<TakeStoryboard>
    | undefined;
  if (!board?.scene || !board.sceneBar || !board.sceneBeat)
    throw new Error(
      `${file} exports no storyboard (default, \`storyboard\` or \`board\`: defineStoryboard's result)`,
    );
  return board as TakeStoryboard;
};

/** Where a spec's take sits in its scene (see `place`). */
export interface TakePlacementSpec {
  id: string;
  /** The storyboard scene the take is for. */
  scene?: string;
  /** The song bar the scene's first bar must play (the take was made for it). */
  songBar?: number;
  /** End the take early: after the scene's first `bars` bars, or `tail` frames after the scene. */
  window?: {bars?: number; tail?: number};
}

export interface TakePlacement {
  /** Film frame of a bar and beat counted from the scene's first bar. */
  beat: SceneBeat;
  /** First and last film frames the take records, inclusive. */
  from: number;
  to: number;
}

export interface FilmTimeline {
  fps: number;
  segments: readonly Segment[];
  /**
   * Film frame -> {songSec, segment, pinned}. Pass `segment` to pin the
   * mapping to one segment (extended past its ends) instead of following the
   * edit.
   */
  songAt(
    frame: number,
    segment?: number,
  ): {songSec: number; segment: number; pinned: boolean};
  /** Film frame of a video bar and beat, as the film's `frameOfBeat` places it. */
  frameOfBeat(bar: number, beat?: number): number;
  /** (Fractional) film frame at which song second `songSec` plays in `segment`. */
  frameOfSong(songSec: number, segment: number): number;
  /**
   * Where a spec's take sits in the film: its scene with the handle on each
   * side, unless the spec's `window` ends it elsewhere (`{bars}`: after the
   * scene's first `bars` bars; `{tail}`: that many frames after the scene).
   * With `songBar`, throws unless the scene's first bar plays that bar of
   * the song.
   */
  place(spec: TakePlacementSpec): TakePlacement;
}

/**
 * A film's timeline for placing takes. `storyboard` is needed for `place`;
 * `handleSec` is how long a take records on each side of its scene.
 */
export const loadTimeline = (
  file: string,
  {
    storyboard = null,
    handleSec = DEFAULT_HANDLE_SEC,
  }: {storyboard?: TakeStoryboard | null; handleSec?: number} = {},
): FilmTimeline => {
  const tl = assertTimeline(JSON.parse(fs.readFileSync(file, 'utf8')), file);
  const {fps, segments} = tl;
  const {frameOfBeat} = beatGrid(tl);
  const handle = Math.round(toFrames(handleSec, fps));
  return {
    fps,
    segments,
    songAt(frame, pinnedSegment) {
      const segment = pinnedSegment ?? segmentIndexAt(frame / fps, segments);
      return {
        songSec: songTimeAt(frame / fps, segments, segment),
        segment,
        pinned: pinnedSegment !== undefined,
      };
    },
    frameOfBeat,
    frameOfSong(songSec, segment) {
      return videoTimeOfSong(songSec, segments, segment) * fps;
    },
    place(spec) {
      if (!storyboard)
        throw new Error(`${spec.id}: placing a take needs a storyboard`);
      if (!spec.scene) throw new Error(`${spec.id} names no scene`);
      const scene = storyboard.scene(spec.scene);
      const first = storyboard.sceneBar(scene.id);
      if (spec.songBar !== undefined) {
        const plays = tl.bars.find(b => b.index === first)?.songBar;
        if (plays !== spec.songBar) {
          throw new Error(
            `${spec.id} was made for ${scene.id} opening on song bar ${spec.songBar}, but the edit plays song bar ${plays} there`,
          );
        }
      }
      const beat = storyboard.sceneBeat(frameOfBeat, scene.id);
      const {bars, tail = handle} = spec.window ?? {};
      return {
        beat,
        from: scene.from - handle,
        to: bars === undefined ? scene.to - 1 + tail : beat(bars),
      };
    },
  };
};
