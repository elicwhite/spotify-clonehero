/**
 * A film is an edit of a song: each timeline segment plays one stretch of
 * it. These map between video seconds (film time) and song seconds (chart
 * time, which is also the song audio's time). Pure.
 */
import type {Segment} from './contract';

/** Index of the segment playing at `videoSec`, or of the nearest one outside the edit. */
export const segmentIndexAt = (
  videoSec: number,
  segments: readonly Segment[],
): number => {
  if (segments.length === 0) {
    throw new Error('[songTime] the timeline has no segments');
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as Segment;
    if (videoSec < seg.videoEnd) {
      return videoSec >= seg.videoStart || i === 0 ? i : i - 1;
    }
  }
  return segments.length - 1;
};

/**
 * Index of the segment that plays song second `songSec`, or null when the
 * edit skips it (the first such segment when the edit repeats a stretch).
 */
export const segmentIndexOfSong = (
  songSec: number,
  segments: readonly Segment[],
): number | null => {
  // A small epsilon absorbs float noise from ms -> s conversions.
  const i = segments.findIndex(
    s => songSec >= s.songStart - 1e-9 && songSec < s.songEnd - 1e-9,
  );
  return i < 0 ? null : i;
};

/**
 * Song seconds shown at `videoSec`: `videoSec - videoStart + songStart` of
 * the segment playing then. `segmentIndex` pins the mapping to one segment
 * and extrapolates past its ends, for a highway that stays on screen across
 * a cut and keeps scrolling instead of jumping.
 */
export const songTimeAt = (
  videoSec: number,
  segments: readonly Segment[],
  segmentIndex: number = segmentIndexAt(videoSec, segments),
): number => {
  const seg = segments[segmentIndex];
  if (!seg) throw new Error(`[songTime] no timeline segment ${segmentIndex}`);
  return videoSec - seg.videoStart + seg.songStart;
};

/** Video seconds at which song second `songSec` plays inside segment `segmentIndex`. */
export const videoTimeOfSong = (
  songSec: number,
  segments: readonly Segment[],
  segmentIndex: number,
): number => {
  const seg = segments[segmentIndex];
  if (!seg) throw new Error(`[songTime] no timeline segment ${segmentIndex}`);
  return songSec - seg.songStart + seg.videoStart;
};
