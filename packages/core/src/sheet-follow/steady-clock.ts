/**
 * A song clock that moves forward smoothly, for a page to follow.
 *
 * The follower re-anchors its estimate every half second, and a correction
 * moves the estimate back about one time in four. A page that follows the raw
 * estimate visibly steps back each time. This clock instead runs at the pace
 * the estimate sets and closes on it gradually: when the estimate is ahead it
 * speeds up, and when it is behind it slows down, to a stop at most. It never
 * runs backward for a small correction.
 *
 * A difference larger than {@link JUMP_SEC} is not a correction but a new
 * position — a seek, or the band starting over — and the clock takes it at
 * once, either way.
 */

/** A difference this large, in seconds, is taken as a new position. */
const JUMP_SEC = 4;

/** How strongly the clock closes on the estimate: at a difference of `e`
 *  seconds its rate changes by `e * CATCH_UP_PER_SEC`. */
const CATCH_UP_PER_SEC = 2;

/** The fastest the clock runs, relative to real time, while catching up. */
const MAX_RATE = 3;

/**
 * Wraps a time source. Call the result once per animation frame; it returns
 * null whenever the source does, and starts from the source's value when the
 * source returns again.
 */
export function steadyClock(
  source: () => number | null,
  now: () => number = () => performance.now(),
): () => number | null {
  let shown: number | null = null;
  let lastMs = 0;
  return () => {
    const target = source();
    const nowMs = now();
    const dt = Math.min(0.25, (nowMs - lastMs) / 1000);
    lastMs = nowMs;
    if (target == null) {
      shown = null;
      return null;
    }
    if (shown == null || Math.abs(target - shown) > JUMP_SEC) {
      shown = target;
      return shown;
    }
    const rate = Math.min(
      MAX_RATE,
      Math.max(0, 1 + (target - shown) * CATCH_UP_PER_SEC),
    );
    shown += rate * dt;
    return shown;
  };
}
