/**
 * The take-versus-edit check: a take records the song time the app showed on
 * every frame, and a film plays the music through its own edit. When the
 * edit changes after a take was recorded, the take shows the wrong moment of
 * the song; this check fails the render instead. Pure (Node-safe).
 */
import {toSec} from '../format/format';
import type {Segment} from '../music/contract';
import {songTimeAt} from '../music/songTime';
import type {RecordingManifest, SongTimeMap} from './manifest';

/**
 * How far a take's song time may sit from the film's on a frame, in frames:
 * half a frame, the rounding `recordedFrameAt` picks a take's frame with.
 */
const TOLERANCE_FRAMES = 0.5;

/** Windows of takes already checked, per edit (a take never changes within a page). */
const checked = new WeakMap<readonly Segment[], Set<string>>();

/**
 * The song second the film plays at `videoSec` for a range of a take: the
 * edit's, or, for a pinned range, its segment's mapping carried past the
 * segment's ends, as the take played it.
 */
const filmSongSec = (
  m: RecordingManifest,
  range: SongTimeMap['ranges'][number],
  videoSec: number,
  segments: readonly Segment[],
): number => {
  if (!range.pinned) return songTimeAt(videoSec, segments);
  if (!segments[range.segment])
    throw new Error(
      `${m.id} was recorded pinned to segment ${range.segment} of the music's edit, which the edit no longer has`,
    );
  return songTimeAt(videoSec, segments, range.segment);
};

/**
 * Throws when a take was recorded for another edit of the music: on every
 * film frame of the window [from, to) that the take also covers, the song
 * time it recorded (`manifest.songTime`) must be the song time the film
 * plays there through `segments` (a pinned range: through its own segment).
 * Frames outside the window are not checked: a take's handles may
 * legitimately play past a splice. A take that follows no song (no
 * `songTime`) has nothing to check. `writtenBy` names the command that
 * re-records it.
 */
export const assertTakeMatchesEdit = (
  m: RecordingManifest,
  segments: readonly Segment[],
  window: {from: number; to: number},
  writtenBy?: string,
): void => {
  if (!m.songTime) return;
  const key = `${m.id}|${m.recordedAt}|${window.from}|${window.to}`;
  let done = checked.get(segments);
  if (!done) checked.set(segments, (done = new Set()));
  if (done.has(key)) return;
  const from = Math.max(window.from, m.range.from);
  const to = Math.min(window.to - 1, m.range.to);
  for (const r of m.songTime.ranges) {
    for (
      let f = Math.max(from, r.fromFrame);
      f <= Math.min(to, r.toFrame);
      f++
    ) {
      const take = r.songSecAtFromFrame + toSec(f - r.fromFrame, m.fps);
      const film = filmSongSec(m, r, toSec(f, m.fps), segments);
      if (Math.abs(take - film) > toSec(TOLERANCE_FRAMES, m.fps)) {
        const again = writtenBy ? ` Re-record it: ${writtenBy}` : '';
        throw new Error(
          `${m.id} was recorded for another edit of the music: at film frame ${f} it shows song ${take.toFixed(3)} s, where the film plays ${film.toFixed(3)} s (scene ${window.from}-${window.to - 1}).${again}`,
        );
      }
    }
  }
  done.add(key);
};
