/**
 * Peak picking for drum transcription model output.
 *
 * Exact port of the reference `peak_pick` in
 * analysis/stage1_eval/common.py (research repo), as inlined verbatim in
 * scripts/dump_frontend_reference.py:
 *
 *   1. Candidate peaks are STRICT local maxima:
 *        e[i] > e[i-1] && e[i] >= e[i+1], for i in 1..n-2.
 *   2. Greedy NMS: visit candidates by descending height (ties: lower frame
 *      first, matching np.argsort(-e[loc]) order); keep a candidate unless a
 *      previously kept peak is within PEAK_NMS_FRAMES (2 frames = 20 ms at
 *      100 fps) on either side.
 *   3. Keep peaks whose height is STRICTLY greater than the per-lane
 *      threshold. Lanes with threshold > 1.5 are skipped entirely.
 *
 * Events are sorted by (frame, lane), matching the reference pick_all().
 */

import type {ModelOutput, RawDrumEvent, DrumClassName} from './types';
import {
  DRUM_CLASSES,
  NUM_DRUM_CLASSES,
  CRNN_THRESHOLDS,
  MODEL_FPS,
  PEAK_NMS_FRAMES,
  THRESHOLD_LANE_EXCLUDED,
} from './types';

// ---------------------------------------------------------------------------
// Single-lane peak picking (reference common.peak_pick)
// ---------------------------------------------------------------------------

export interface Peak {
  frame: number;
  height: number;
}

/**
 * Strict-local-maxima peak picking with greedy NMS.
 *
 * @param env - Per-frame activation envelope for one lane.
 * @param nmsFrames - NMS window in frames on each side (default 2 = 20 ms).
 * @returns Kept peaks, in greedy (descending-height) keep order.
 */
export function peakPick(
  env: Float32Array,
  nmsFrames: number = PEAK_NMS_FRAMES,
): Peak[] {
  const n = env.length;
  if (n < 3) return [];

  // Strict local maxima: e[i] > e[i-1] && e[i] >= e[i+1].
  const candidates: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1]) {
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return [];

  // Order by descending height; ties broken by lower frame first
  // (np.argsort(-e[loc]) yields the earlier index first on exact ties).
  const order = candidates.slice().sort((a, b) => env[b] - env[a] || a - b);

  const taken = new Uint8Array(n);
  const keep: Peak[] = [];
  for (const f of order) {
    if (taken[f]) continue;
    keep.push({frame: f, height: env[f]});
    const lo = Math.max(0, f - nmsFrames);
    const hi = Math.min(n - 1, f + nmsFrames);
    for (let j = lo; j <= hi; j++) {
      taken[j] = 1;
    }
  }

  return keep;
}

// ---------------------------------------------------------------------------
// Full model output peak picking
// ---------------------------------------------------------------------------

/**
 * Run reference peak picking on the full (post-processed) model output.
 *
 * @param modelOutput - Model output with per-frame activations [t*nClasses+c].
 * @param thresholds - Per-lane thresholds in model order; a peak fires when
 *   its height is strictly greater than the lane threshold. Lanes with a
 *   threshold > 1.5 are skipped.
 * @returns RawDrumEvents sorted by (frame, lane); timeSeconds = frame / 100.
 */
export function pickPeaksFromModelOutput(
  modelOutput: ModelOutput,
  thresholds: readonly number[] = CRNN_THRESHOLDS,
): RawDrumEvent[] {
  const {predictions, nFrames, nClasses} = modelOutput;

  const onsets: {frame: number; lane: number; height: number}[] = [];

  for (let lane = 0; lane < Math.min(nClasses, NUM_DRUM_CLASSES); lane++) {
    const threshold = thresholds[lane];
    if (threshold > THRESHOLD_LANE_EXCLUDED) continue;

    const env = new Float32Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
      env[t] = predictions[t * nClasses + lane];
    }

    for (const peak of peakPick(env)) {
      if (peak.height > threshold) {
        onsets.push({frame: peak.frame, lane, height: peak.height});
      }
    }
  }

  // Sort by (frame, lane), matching the reference pick_all().
  onsets.sort((a, b) => a.frame - b.frame || a.lane - b.lane);

  return onsets.map(o => {
    const drumClass = DRUM_CLASSES[o.lane];
    return {
      timeSeconds: o.frame / MODEL_FPS,
      drumClass: drumClass.name as DrumClassName,
      midiPitch: drumClass.midiPitch,
      confidence: o.height,
    };
  });
}
