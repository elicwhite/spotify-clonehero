/**
 * How BS-Roformer separation's own sub-steps fold into the single
 * 'separating' step every surface shows.
 *
 * `separateStems` reports three sub-steps that each count 0 → 1 (download
 * the model, run it, store the stem). Reported verbatim, a progress bar
 * would reset twice mid-step, so each sub-step gets a sub-range of the step
 * instead and the bar only ever moves forward.
 */

import type {DrumSeparationProgress} from '@/lib/audio-pipeline/separate-stems';

const SEPARATION_STAGE_RANGES: Record<
  DrumSeparationProgress['step'],
  [number, number]
> = {
  'loading-model': [0, 0.15],
  processing: [0.15, 0.97],
  storing: [0.97, 1],
  done: [1, 1],
};

/** One separation progress event as a 0-1 fraction of the 'separating' step. */
export function separationProgressToFraction(
  p: DrumSeparationProgress,
): number {
  const [lo, hi] = SEPARATION_STAGE_RANGES[p.step];
  return lo + (hi - lo) * Math.min(1, Math.max(0, p.percent));
}
