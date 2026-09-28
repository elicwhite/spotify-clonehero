/**
 * Cue helpers: turning a musical position into the frame something lands on.
 */

/**
 * The event nearest `target` if one lies within `maxFrames` of it (ties go to
 * the earlier event), else `target` itself. A cue written on the grid snaps
 * onto the hit the band actually plays near it:
 * `snapToEvent(tl.frameOfBeat(bar), tl.downbeatHitFrames, 2)`.
 */
export const snapToEvent = (
  target: number,
  events: readonly number[],
  maxFrames: number,
): number => {
  let best = target;
  let bestDistance = Infinity;
  for (const event of events) {
    const distance = Math.abs(event - target);
    if (
      distance <= maxFrames &&
      (distance < bestDistance || (distance === bestDistance && event < best))
    ) {
      best = event;
      bestDistance = distance;
    }
  }
  return best;
};
