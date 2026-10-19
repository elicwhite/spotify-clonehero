/**
 * Loop-region decision logic for `AudioManager`.
 *
 * Kept free of Web Audio so it can be unit tested: this module answers
 * "given where the playhead is, should we seek, and to where?" while
 * `AudioManager` owns the clocks and performs the seek.
 */

export interface LoopRegion {
  startMs: number;
  endMs: number;
}

/**
 * Shortest loop any surface may produce. The A/B buttons spread the two
 * markers this far apart when they would otherwise land on the same
 * millisecond, and a flag drag clamps to it, so a loop is always long enough
 * for {@link isUsableLoopRegion} to accept and wide enough to grab again.
 */
export const MIN_LOOP_SPAN_MS = 100;

export interface LoopEvaluationInput {
  /** Playhead position, in the same time base as `region`. */
  currentMs: number;
  region: LoopRegion | null;
  isPlaying: boolean;
  /**
   * Whether the user has left the loop behind by seeking to or past its end.
   * Pass the `escaped` value returned by the previous evaluation; the seek
   * path sets it via {@link seekEscapesLoop} and installing a region clears
   * it.
   */
  escaped: boolean;
  /**
   * `true` confines the playhead to the region — reaching it from before
   * jumps in, and being past the end always jumps back, whatever the user
   * seeked. Practice mode (the sheet-music / drum-fills section trainer)
   * works this way.
   *
   * `false` (the editor's A/B loop) treats the region as a one-way gate:
   * playback runs into it normally and wraps at its end, but a user who
   * deliberately seeks past the end is left alone, because being unable to
   * audition anything after the loop end without first clearing the loop
   * would trap them. Only a seek escapes: a playhead that is past the end
   * because the region itself moved (dragging the end flag behind the
   * playhead) is pulled back on the next frame of playback.
   */
  confine?: boolean;
}

export interface LoopEvaluation {
  /** Where to seek, in the input's time base, or `null` to keep playing. */
  seekToMs: number | null;
  /** Escape latch to feed into the next evaluation. */
  escaped: boolean;
}

/**
 * A region can drive playback only if it spans a positive amount of time
 * once its start is clamped to zero. Zero-length, inverted and entirely
 * negative regions are rejected here so a loop can never seek back onto its
 * own trigger point and spin.
 */
export function isUsableLoopRegion(
  region: LoopRegion | null | undefined,
): region is LoopRegion {
  return (
    region != null &&
    Number.isFinite(region.startMs) &&
    Number.isFinite(region.endMs) &&
    region.endMs > Math.max(0, region.startMs)
  );
}

/**
 * Whether seeking to `targetMs` (the region's time base) counts as the user
 * leaving the loop. Landing at or past the end releases the loop until the
 * playhead is back before it; anything else puts the loop back in charge.
 */
export function seekEscapesLoop(
  region: LoopRegion | null | undefined,
  targetMs: number,
): boolean {
  return (
    isUsableLoopRegion(region) &&
    Number.isFinite(targetMs) &&
    targetMs >= region.endMs
  );
}

export function evaluateLoop({
  currentMs,
  region,
  isPlaying,
  escaped,
  confine = false,
}: LoopEvaluationInput): LoopEvaluation {
  if (!isUsableLoopRegion(region)) {
    // No loop to escape from, so the next one starts from a clean latch.
    return {seekToMs: null, escaped: false};
  }
  if (!Number.isFinite(currentMs)) {
    return {seekToMs: null, escaped};
  }

  // Being before the end — by playing in, by wrapping, or by the end flag
  // moving ahead of the playhead — puts the loop back in charge.
  const beforeEnd = currentMs < region.endMs;
  const nextEscaped = beforeEnd ? false : escaped;

  if (!isPlaying) {
    return {seekToMs: null, escaped: nextEscaped};
  }

  const target = Math.max(0, region.startMs);

  if (beforeEnd) {
    if (confine && currentMs < region.startMs) {
      return {seekToMs: target, escaped: false};
    }
    // Inside the region, or approaching it — let playback run.
    return {seekToMs: null, escaped: false};
  }

  // At or past the end. A confined loop always wraps; an A/B loop wraps
  // unless the user seeked out here themselves.
  if (nextEscaped && !confine) {
    return {seekToMs: null, escaped: true};
  }

  return {seekToMs: target, escaped: false};
}
