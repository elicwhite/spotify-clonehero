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
 * Max-2-hands constraint: kick (BD, lane 0) is a foot pedal, so at most 2
 * NON-KICK lanes can physically sound at one instant (2 hands). Validated
 * 2026-07-14 against the 1022-song corpus (drum-to-chart repo,
 * analysis/max2hands_*.py): GT violates this in only 0.0017% of non-kick
 * instants (3/1022 songs — the rare exception is plausibly a hihat foot-chick,
 * not a 3rd hand); the model violates it in 0.38% of prediction clusters
 * (528/1022 songs), 72% of which are crash+ride+snare — the cymbal-hedging
 * analog of the tom-lane hedging mechanism found in the tom-detection
 * diagnostic (two acoustically-adjacent cymbal lanes both firing on one real
 * hit). This survives because the existing top-2-within-toms and
 * top-2-within-cymbals rules above never fire on a 2-cymbal case, and snare
 * is outside both groups — the gap this rule closes. Full-corpus decode-only
 * A/B: pooled edit_rate -0.0011, 432 songs improved, 5 regressed, worst-decile
 * unaffected. Default ON.
 *
 * Reproduced end-to-end on a real auto-generated chart (Rooftops REMIX,
 * MusicCharts.tools export, tick 195000 -> 2:42.6): the model hedges crash
 * (~0.70-0.82) and ride (~0.71-0.81) at every hit of a repeating blast-beat
 * figure alongside a clear snare (~0.85-0.89), producing an unplayable
 * snare+crash+ride chord 7 times in a row.
 */
const MAX_2_HANDS = true;
const MAX_2_HANDS_WINDOW_MS = 10;

interface ScoredOnset {
  frame: number;
  lane: number;
  height: number;
}

/**
 * Cluster non-kick onsets by CHAINED adjacency (each onset within
 * `windowFrames` of the previous one in the same cluster, so a cluster can
 * span more than the window end-to-end) and, within any cluster spanning
 * >= 3 distinct lanes, keep only the top-2 lanes by peak height (ties broken
 * by lower lane index, matching the file's other tie-break convention).
 * Kick onsets always pass through untouched. Mirrors
 * analysis/max2hands_decode_constraint.py's `apply_max2hands` (mode="top2")
 * in the research repo exactly.
 */
export function applyMaxTwoHands(
  onsets: readonly ScoredOnset[],
  windowMs: number = MAX_2_HANDS_WINDOW_MS,
): ScoredOnset[] {
  const windowFrames = Math.round((windowMs / 1000) * MODEL_FPS);
  const kick = onsets.filter(o => o.lane === 0);
  const nonKick = onsets.filter(o => o.lane !== 0).slice();
  // onsets arrives frame-sorted (see pickPeaksFromModelOutput below); the
  // filtered subsequence preserves that order.
  if (nonKick.length === 0) return onsets.slice();

  const drop = new Set<number>(); // indices into nonKick
  let clusterStart = 0;
  for (let i = 1; i <= nonKick.length; i++) {
    const chainBroken =
      i === nonKick.length ||
      nonKick[i].frame - nonKick[i - 1].frame > windowFrames;
    if (!chainBroken) continue;

    const clusterIdx = Array.from(
      {length: i - clusterStart},
      (_, k) => clusterStart + k,
    );
    const distinctLanes = new Set(clusterIdx.map(idx => nonKick[idx].lane));
    if (distinctLanes.size >= 3) {
      // Best (highest) height per lane within the cluster.
      const bestIdxByLane = new Map<number, number>();
      for (const idx of clusterIdx) {
        const lane = nonKick[idx].lane;
        const cur = bestIdxByLane.get(lane);
        if (cur === undefined || nonKick[idx].height > nonKick[cur].height) {
          bestIdxByLane.set(lane, idx);
        }
      }
      const ranked = [...bestIdxByLane.entries()].sort(
        (a, b) => nonKick[b[1]].height - nonKick[a[1]].height || a[0] - b[0],
      );
      for (const [, idx] of ranked.slice(2)) {
        drop.add(idx);
      }
    }
    clusterStart = i;
  }

  const kept = nonKick.filter((_, idx) => !drop.has(idx));
  return [...kick, ...kept].sort(
    (a, b) => a.frame - b.frame || a.lane - b.lane,
  );
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

  const finalOnsets = MAX_2_HANDS ? applyMaxTwoHands(onsets) : onsets;

  return finalOnsets.map(o => {
    const drumClass = DRUM_CLASSES[o.lane];
    return {
      timeSeconds: o.frame / MODEL_FPS,
      drumClass: drumClass.name as DrumClassName,
      midiPitch: drumClass.midiPitch,
      confidence: o.height,
    };
  });
}
