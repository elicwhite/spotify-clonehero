/**
 * Which song second a highway shows on a film frame, and how the app's
 * playback reached it. Pure (Node-safe): the highway reads it per frame
 * and the tests check it.
 */
import type {Segment} from '../music/contract';
import {segmentIndexAt, songTimeAt, videoTimeOfSong} from '../music/songTime';

export interface SongPositionInput {
  /** Film frame (global). */
  frame: number;
  fps: number;
  /** An explicit song second at the strikeline (a still, a scripted time). */
  songTimeSec?: number;
  /** The film's edit of the song: each segment plays one stretch of it. */
  segments?: readonly Segment[];
  /** Pin the film-to-song mapping to one segment (for a shot that crosses a cut). */
  segmentIndex?: number;
  /** Song second the app's playback last started from (its last seek). */
  playbackFromSec?: number;
}

/**
 * How the app's playback reached a frame. The karaoke line is the one part
 * of the app's picture that depends on the frames before, so the highway
 * replays this playback before it draws the frame.
 *
 * - `fromFrame`: playback on the film's frames from film frame `fromFrame`
 *   up to this one, each frame showing its own song position.
 * - `fromSec`: playback at 1x from song second `fromSec` on a grid of the
 *   film's frame rate, for an explicit song time. When the time is not on
 *   that grid, the frame is a seek to it.
 */
export type Playback = {fromFrame: number} | {fromSec: number};

export interface SongPosition {
  /** Song second at the strikeline. */
  songSec: number;
  playback: Playback;
}

/** The first film frame at or after `videoSec` (film frames start at 0). */
const firstFrameAt = (videoSec: number, fps: number): number =>
  Math.max(0, Math.ceil(videoSec * fps - 1e-6));

/**
 * The song position of a frame.
 *
 * - With `songTimeSec`, that second, and by default every frame is a seek
 *   to it (`fromSec` is the time itself).
 * - With `segments`, film time mapped through the edit, played on film
 *   frames from the first frame of the segment playing (where the film cuts
 *   to it). A frame before that frame (a pinned `segmentIndex` ahead of its
 *   cut) is a seek.
 * - With neither, film time is song time, played from film frame 0.
 *
 * `playbackFromSec` moves the start of playback to the song second given:
 * on the grid for an explicit time, else the film frame that plays it.
 */
export const songPositionAt = (input: SongPositionInput): SongPosition => {
  const {frame, fps, segments, playbackFromSec} = input;
  if (input.songTimeSec !== undefined)
    return {
      songSec: input.songTimeSec,
      playback: {fromSec: playbackFromSec ?? input.songTimeSec},
    };
  const videoSec = frame / fps;
  if (!segments) {
    const start =
      playbackFromSec === undefined ? 0 : firstFrameAt(playbackFromSec, fps);
    return {
      songSec: videoSec,
      playback: {fromFrame: Math.min(start, frame)},
    };
  }
  const index = input.segmentIndex ?? segmentIndexAt(videoSec, segments);
  const segment = segments[index];
  if (!segment) throw new Error(`[highway] no timeline segment ${index}`);
  const startSec =
    playbackFromSec === undefined
      ? segment.videoStart
      : videoTimeOfSong(playbackFromSec, segments, index);
  return {
    songSec: songTimeAt(videoSec, segments, index),
    playback: {fromFrame: Math.min(firstFrameAt(startSec, fps), frame)},
  };
};
