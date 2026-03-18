/**
 * Peak picking for drum transcription model output.
 *
 * Ports madmom's NotePeakPickingProcessor to JavaScript.
 * Applied independently per class to the model's sigmoid output.
 *
 * Algorithm:
 *   1. Moving average (preAvg + postAvg window)
 *   2. Moving maximum (preMax + postMax window)
 *   3. Threshold + local max test: a frame is a peak if:
 *      - Its value exceeds the per-class threshold
 *      - Its value equals the local maximum
 *      - Its value exceeds the local average
 *   4. Combine: merge detections within `combine` window (keep highest)
 *
 * Reference: madmom.features.notes.NotePeakPickingProcessor
 */

import type {
  ModelOutput,
  RawDrumEvent,
  PeakPickingParams,
  AdtofClassName,
} from './types';
import {
  ADTOF_CLASSES,
  NUM_ADTOF_CLASSES,
  DEFAULT_PEAK_PICKING_PARAMS,
  ADTOF_THRESHOLDS,
} from './types';

// ---------------------------------------------------------------------------
// Moving window helpers
// ---------------------------------------------------------------------------

/**
 * Compute the moving average of a signal with asymmetric pre/post windows.
 *
 * For each index i, average over [i - preFrames, i + postFrames].
 * Values outside the signal boundaries are treated as 0.
 */
export function movingAverage(
  signal: Float32Array,
  preFrames: number,
  postFrames: number,
): Float32Array {
  const n = signal.length;
  const result = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - preFrames);
    const end = Math.min(n - 1, i + postFrames);
    let sum = 0;
    for (let j = start; j <= end; j++) {
      sum += signal[j];
    }
    result[i] = sum / (end - start + 1);
  }

  return result;
}

/**
 * Compute the moving maximum of a signal with asymmetric pre/post windows.
 *
 * For each index i, maximum over [i - preFrames, i + postFrames].
 */
export function movingMaximum(
  signal: Float32Array,
  preFrames: number,
  postFrames: number,
): Float32Array {
  const n = signal.length;
  const result = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - preFrames);
    const end = Math.min(n - 1, i + postFrames);
    let max = -Infinity;
    for (let j = start; j <= end; j++) {
      if (signal[j] > max) {
        max = signal[j];
      }
    }
    result[i] = max;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Single-class peak picking
// ---------------------------------------------------------------------------

interface PeakCandidate {
  frame: number;
  value: number;
}

/**
 * Run peak picking on a single activation function (one class).
 *
 * @param activations - Per-frame activation values for one class.
 * @param threshold - Detection threshold for this class.
 * @param params - Peak picking parameters.
 * @returns Array of (frame, value) peaks.
 */
export function pickPeaks(
  activations: Float32Array,
  threshold: number,
  params: PeakPickingParams,
): PeakCandidate[] {
  const n = activations.length;
  if (n === 0) return [];

  // Convert time-based window sizes to frames
  const preAvgFrames = Math.round(params.preAvg * params.fps);
  const postAvgFrames = Math.round(params.postAvg * params.fps);
  const preMaxFrames = Math.round(params.preMax * params.fps);
  const postMaxFrames = Math.round(params.postMax * params.fps);
  const combineFrames = Math.round(params.combine * params.fps);

  // Step 1: Moving average
  const avg = movingAverage(activations, preAvgFrames, postAvgFrames);

  // Step 2: Moving maximum
  const max = movingMaximum(activations, preMaxFrames, postMaxFrames);

  // Step 3: Threshold + local max + above average test
  const candidates: PeakCandidate[] = [];
  for (let i = 0; i < n; i++) {
    const val = activations[i];
    if (val >= threshold && val >= max[i] && val >= avg[i]) {
      candidates.push({frame: i, value: val});
    }
  }

  // Step 4: Combine detections within window (keep highest)
  if (combineFrames <= 0 || candidates.length === 0) {
    return candidates;
  }

  const combined: PeakCandidate[] = [candidates[0]];
  for (let i = 1; i < candidates.length; i++) {
    const last = combined[combined.length - 1];
    if (candidates[i].frame - last.frame <= combineFrames) {
      // Within combine window: keep the one with higher activation
      if (candidates[i].value > last.value) {
        combined[combined.length - 1] = candidates[i];
      }
    } else {
      combined.push(candidates[i]);
    }
  }

  return combined;
}

// ---------------------------------------------------------------------------
// Full model output peak picking
// ---------------------------------------------------------------------------

/**
 * Run peak picking on the full model output (all classes).
 *
 * @param modelOutput - Model output with per-frame predictions.
 * @param thresholds - Per-class detection thresholds.
 * @param params - Peak picking parameters.
 * @returns Array of RawDrumEvent sorted by time.
 */
export function pickPeaksFromModelOutput(
  modelOutput: ModelOutput,
  thresholds: Record<AdtofClassName, number> = ADTOF_THRESHOLDS,
  params: PeakPickingParams = DEFAULT_PEAK_PICKING_PARAMS,
): RawDrumEvent[] {
  const {predictions, nFrames, nClasses} = modelOutput;
  const events: RawDrumEvent[] = [];
  const frameDuration = 1.0 / params.fps;

  for (let cls = 0; cls < Math.min(nClasses, NUM_ADTOF_CLASSES); cls++) {
    // Extract the activation function for this class
    const activations = new Float32Array(nFrames);
    for (let frame = 0; frame < nFrames; frame++) {
      activations[frame] = predictions[frame * nClasses + cls];
    }

    const adtofClass = ADTOF_CLASSES[cls];
    const className = adtofClass.name as AdtofClassName;
    const threshold = thresholds[className];

    // Pick peaks for this class
    const peaks = pickPeaks(activations, threshold, params);

    // Convert to RawDrumEvent
    for (const peak of peaks) {
      events.push({
        timeSeconds: peak.frame * frameDuration,
        drumClass: className,
        midiPitch: adtofClass.midiPitch,
        confidence: peak.value,
      });
    }
  }

  // Sort by time
  events.sort((a, b) => a.timeSeconds - b.timeSeconds);

  return events;
}
