/**
 * Where a chart's video background should be for a point in the song, by
 * YARG's rules (`BackgroundManager.cs`):
 *
 *  - video time = song audio time + `video_start_time`. A positive start time
 *    skips the front of the video; a negative one holds the video back.
 *  - Before the video's start and after its end there is no frame to show.
 *  - A video with no start time that is much shorter than the song (under 85%
 *    of it) is a loop, not a synced clip, so it repeats.
 */

/** Start times inside this window count as "not set" for the loop rule. */
const START_TIME_THRESHOLD_SECONDS = 0.025;
/** A video shorter than this share of the song loops. */
const DONT_LOOP_THRESHOLD = 0.85;

export function backgroundVideoTime(options: {
  /** The song's own audio position, in seconds from the audio's sample 0. */
  audioTimeSeconds: number;
  /** The chart's `video_start_time`, in seconds. */
  videoStartSeconds: number;
  videoDurationSeconds: number;
  songDurationSeconds: number;
}): number | null {
  const {
    audioTimeSeconds,
    videoStartSeconds,
    videoDurationSeconds,
    songDurationSeconds,
  } = options;
  if (!(videoDurationSeconds > 0) || audioTimeSeconds < 0) return null;

  const videoTime = audioTimeSeconds + videoStartSeconds;
  if (videoTime < 0) return null;

  const loops =
    Math.abs(videoStartSeconds) < START_TIME_THRESHOLD_SECONDS &&
    videoDurationSeconds < songDurationSeconds * DONT_LOOP_THRESHOLD;
  if (loops) return videoTime % videoDurationSeconds;

  return videoTime < videoDurationSeconds ? videoTime : null;
}
