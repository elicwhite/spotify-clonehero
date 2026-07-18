/**
 * The one place either feature applies KS-WARP / REACH-EXTENSION to a
 * predicted Synctrack before it's installed.
 *
 * Extracted out of drum-transcription/pipeline/chart-builder.ts (which still
 * calls this, unchanged in behavior) so /tempo's tempo-only pipeline
 * (drum-transcription/pipeline/tempo-track.ts) can call the SAME function on
 * the SAME (rawSynctrack, events) inputs and be structurally guaranteed to
 * produce the identical final grid — see tempo-track.ts's docstring for the
 * no-drift argument.
 */

import {
  warpGrid,
  warpGridReach,
  KS_WARP_ENABLED,
  KS_WARP_REACH_ENABLED,
} from './ks-warp';
import type {Synctrack} from './types';

/** The only fields the warp step reads off an onset — a subset of
 * drum-transcription's `RawDrumEvent` so this module doesn't need to depend
 * on drum-transcription's types. */
export interface WarpOnsetLike {
  timeSeconds: number;
  drumClass: string;
}

/**
 * Apply KS-WARP (kick+snare onset-anchored drift warp) / REACH-EXTENSION to
 * `synctrack` using `events` as the onset anchors, per the KS_WARP_ENABLED /
 * KS_WARP_REACH_ENABLED flags in ks-warp.ts. A structural no-op
 * (byte-identical grid) unless the deployable gate admits. Onsets are RAW
 * (uncorrected) times, matching the Python reference's SF.decode("raw", ...)
 * contract — see ks-warp.ts's module docstring.
 *
 * Returns `synctrack` unchanged when it has no tempos (nothing to warp) or
 * when both flags are off.
 */
export function finalizeSynctrack<E extends WarpOnsetLike>(
  synctrack: Synctrack,
  events: readonly E[],
): Synctrack {
  if (!synctrack || synctrack.tempos.length === 0) return synctrack;

  if (KS_WARP_REACH_ENABLED) {
    const ksOnsetsMs = events
      .filter(e => e.drumClass === 'BD' || e.drumClass === 'SD')
      .map(e => e.timeSeconds * 1000);
    const allOnsetsMs = events.map(e => e.timeSeconds * 1000);
    const {grid: warped} = warpGridReach(synctrack, ksOnsetsMs, allOnsetsMs);
    return warped ?? synctrack;
  }

  if (KS_WARP_ENABLED) {
    const ksOnsetsMs = events
      .filter(e => e.drumClass === 'BD' || e.drumClass === 'SD')
      .map(e => e.timeSeconds * 1000);
    const {grid: warped} = warpGrid(synctrack, ksOnsetsMs);
    return warped ?? synctrack;
  }

  return synctrack;
}
