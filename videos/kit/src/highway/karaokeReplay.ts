/**
 * The karaoke line is the one stateful part of the app's picture: whether a
 * line is sliding into place depends on the frames drawn before. So the
 * highway draws a frame by replaying the app's playback up to it
 * (`songPositionAt`'s `playback`), drawing every step the way continuous
 * playback would have, and then the frame itself. Frames usually arrive in
 * order, so only the steps since the last frame drawn are replayed; anything
 * else starts again from where playback started.
 *
 * Without karaoke lines nothing is replayed: the rest of the picture depends
 * on the song time alone. Pure (Node-safe): the stage is reached through
 * `ReplayTarget`.
 */
import {songPositionAt, type SongPositionInput} from './songPosition';

/** The karaoke lines the stage is given (`setLyricsData`'s arguments). */
export interface Karaoke {
  lyrics: {msTime: number; text: string; msLength?: number}[];
  phrases: {msTime: number; msLength: number}[];
}

export interface ReplayTarget {
  /** Give the stage its karaoke lines, which also resets the line's state (a seek). */
  setKaraoke: (karaoke: Karaoke) => void;
  /** Draw song second `songSec`. */
  draw: (songSec: number) => void;
}

/** Where the stage's karaoke state is, after a frame is drawn. */
export interface Replay {
  /** What was drawn on (the mounted panes): another one starts again. */
  owner: unknown;
  karaoke: Karaoke;
  /** Where playback started. */
  from: string;
  /** The last step drawn: a film frame, or a step on the song-second grid. */
  step: number;
}

interface Run {
  from: string;
  /** The first step of the run, and this frame's step. */
  first: number;
  step: number;
  /** Song second of step `k`. */
  at: (k: number) => number;
}

const runOf = (
  input: SongPositionInput,
): {songSec: number; run: Run | null} => {
  const {songSec, playback} = songPositionAt(input);
  if ('fromFrame' in playback)
    return {
      songSec,
      run: {
        from: `frame ${playback.fromFrame}`,
        first: playback.fromFrame,
        step: input.frame,
        at: k => songPositionAt({...input, frame: k}).songSec,
      },
    };
  const exact = (songSec - playback.fromSec) * input.fps;
  const step = Math.round(exact);
  if (step < 0 || Math.abs(exact - step) > 1e-6) return {songSec, run: null};
  return {
    songSec,
    run: {
      from: `second ${playback.fromSec}`,
      first: 0,
      step,
      at: k => playback.fromSec + k / input.fps,
    },
  };
};

/**
 * Draw the frame `input` names on `target` as the app's playback would have,
 * continuing from `previous` (what this returned for the frame drawn before
 * on the same stage, or null). Returns the song second drawn and the state
 * to pass with the next frame.
 */
export const drawReplayed = (
  target: ReplayTarget,
  owner: unknown,
  karaoke: Karaoke,
  input: SongPositionInput,
  previous: Replay | null,
): {songSec: number; replay: Replay | null} => {
  const {songSec, run} = runOf(input);
  const resumeAt =
    previous !== null &&
    run !== null &&
    previous.owner === owner &&
    previous.karaoke === karaoke &&
    previous.from === run.from &&
    previous.step <= run.step
      ? previous.step + 1
      : null;
  if (resumeAt === null) target.setKaraoke(karaoke);
  if (run && karaoke.lyrics.length > 0)
    for (let k = resumeAt ?? run.first; k < run.step; k++)
      target.draw(run.at(k));
  target.draw(songSec);
  return {
    songSec,
    replay: run && {owner, karaoke, from: run.from, step: run.step},
  };
};
