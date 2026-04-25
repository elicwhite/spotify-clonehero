/**
 * Tests for the peak picking algorithm.
 *
 * Verifies:
 * - Moving average and moving maximum computations
 * - Single-class peak detection
 * - Full model output peak picking (9 classes)
 * - Combine window behavior
 * - Edge cases (empty input, all zeros, all above threshold)
 */

import {
  movingAverage,
  movingMaximum,
  pickPeaks,
  pickPeaksFromModelOutput,
} from '../ml/peak-picking';
import type {ModelOutput, PeakPickingParams} from '../ml/types';
import {NUM_DRUM_CLASSES} from '../ml/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a simple activation signal with peaks at given positions. */
function makeActivations(
  length: number,
  peaks: {pos: number; value: number; spread?: number}[],
): Float32Array {
  const signal = new Float32Array(length);
  for (const peak of peaks) {
    const spread = peak.spread ?? 3;
    for (let d = -spread; d <= spread; d++) {
      const idx = peak.pos + d;
      if (idx >= 0 && idx < length) {
        const falloff = Math.exp((-d * d) / (2 * (spread / 2) ** 2));
        signal[idx] = Math.max(signal[idx], peak.value * falloff);
      }
    }
  }
  return signal;
}

// ---------------------------------------------------------------------------
// movingAverage
// ---------------------------------------------------------------------------

describe('movingAverage', () => {
  it('returns the signal itself when windows are 0', () => {
    const signal = new Float32Array([1, 2, 3, 4, 5]);
    const result = movingAverage(signal, 0, 0);
    for (let i = 0; i < signal.length; i++) {
      expect(result[i]).toBeCloseTo(signal[i]);
    }
  });

  it('computes correct average with symmetric window', () => {
    const signal = new Float32Array([0, 0, 10, 0, 0]);
    // Window of 1 pre + 1 post: average of 3 values
    const result = movingAverage(signal, 1, 1);

    // Index 0: avg(0, 0) = 0 (boundary: only indices 0, 1)
    expect(result[0]).toBeCloseTo(0);
    // Index 1: avg(0, 0, 10) / 3 = 3.33...
    expect(result[1]).toBeCloseTo(10 / 3);
    // Index 2: avg(0, 10, 0) / 3 = 3.33...
    expect(result[2]).toBeCloseTo(10 / 3);
    // Index 3: avg(10, 0, 0) / 3 = 3.33...
    expect(result[3]).toBeCloseTo(10 / 3);
    // Index 4: avg(0, 0) = 0
    expect(result[4]).toBeCloseTo(0);
  });

  it('handles empty signal', () => {
    const result = movingAverage(new Float32Array(0), 1, 1);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// movingMaximum
// ---------------------------------------------------------------------------

describe('movingMaximum', () => {
  it('returns the signal itself when windows are 0', () => {
    const signal = new Float32Array([1, 2, 3, 2, 1]);
    const result = movingMaximum(signal, 0, 0);
    for (let i = 0; i < signal.length; i++) {
      expect(result[i]).toBeCloseTo(signal[i]);
    }
  });

  it('computes correct maximum with symmetric window', () => {
    const signal = new Float32Array([1, 5, 2, 8, 3]);
    // Window of 1 pre + 1 post
    const result = movingMaximum(signal, 1, 1);

    expect(result[0]).toBe(5); // max(1, 5)
    expect(result[1]).toBe(5); // max(1, 5, 2)
    expect(result[2]).toBe(8); // max(5, 2, 8)
    expect(result[3]).toBe(8); // max(2, 8, 3)
    expect(result[4]).toBe(8); // max(8, 3)
  });

  it('handles empty signal', () => {
    const result = movingMaximum(new Float32Array(0), 1, 1);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pickPeaks (single-class)
// ---------------------------------------------------------------------------

describe('pickPeaks', () => {
  const params: PeakPickingParams = {
    preAvg: 0.1,
    postAvg: 0.01,
    preMax: 0.02,
    postMax: 0.01,
    combine: 0.02,
    fps: 100,
  };

  it('detects a clear isolated peak', () => {
    const activations = makeActivations(200, [{pos: 100, value: 0.8}]);
    const peaks = pickPeaks(activations, 0.3, params);

    expect(peaks.length).toBe(1);
    expect(peaks[0].frame).toBe(100);
    expect(peaks[0].value).toBeCloseTo(0.8);
  });

  it('detects multiple separated peaks', () => {
    const activations = makeActivations(500, [
      {pos: 50, value: 0.7},
      {pos: 200, value: 0.9},
      {pos: 400, value: 0.6},
    ]);
    const peaks = pickPeaks(activations, 0.3, params);

    expect(peaks.length).toBe(3);
    expect(peaks[0].frame).toBe(50);
    expect(peaks[1].frame).toBe(200);
    expect(peaks[2].frame).toBe(400);
  });

  it('ignores peaks below threshold', () => {
    const activations = makeActivations(200, [
      {pos: 50, value: 0.1}, // Below threshold
      {pos: 150, value: 0.8}, // Above threshold
    ]);
    const peaks = pickPeaks(activations, 0.3, params);

    expect(peaks.length).toBe(1);
    expect(peaks[0].frame).toBe(150);
  });

  it('combines nearby peaks within combine window', () => {
    const activations = new Float32Array(200);
    activations[99] = 0.3;
    activations[100] = 0.7;
    activations[101] = 0.3;
    activations[102] = 0.4;
    activations[103] = 0.9;
    activations[104] = 0.4;

    const tightParams: PeakPickingParams = {
      preAvg: 0.01,
      postAvg: 0.01,
      preMax: 0.01,
      postMax: 0.01,
      combine: 0.05,
      fps: 100,
    };
    const peaks = pickPeaks(activations, 0.3, tightParams);

    expect(peaks.length).toBe(1);
    expect(peaks[0].value).toBeCloseTo(0.9);
  });

  it('returns empty for empty input', () => {
    const peaks = pickPeaks(new Float32Array(0), 0.3, params);
    expect(peaks.length).toBe(0);
  });

  it('returns empty for all-zero input', () => {
    const activations = new Float32Array(200);
    const peaks = pickPeaks(activations, 0.3, params);
    expect(peaks.length).toBe(0);
  });

  it('returns empty when all values are below threshold', () => {
    const activations = new Float32Array(200);
    activations.fill(0.1);
    const peaks = pickPeaks(activations, 0.3, params);
    expect(peaks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pickPeaksFromModelOutput (9 classes)
// ---------------------------------------------------------------------------

describe('pickPeaksFromModelOutput', () => {
  it('extracts events from multi-class model output', () => {
    const nFrames = 500;
    const nClasses = NUM_DRUM_CLASSES;
    const predictions = new Float32Array(nFrames * nClasses);

    // Place a BD peak at frame 100
    for (let d = -3; d <= 3; d++) {
      const frame = 100 + d;
      if (frame >= 0 && frame < nFrames) {
        const falloff = Math.exp((-d * d) / 2);
        predictions[frame * nClasses + 0] = 0.8 * falloff; // BD at index 0
      }
    }

    // Place a SD peak at frame 200
    for (let d = -3; d <= 3; d++) {
      const frame = 200 + d;
      if (frame >= 0 && frame < nFrames) {
        const falloff = Math.exp((-d * d) / 2);
        predictions[frame * nClasses + 1] = 0.9 * falloff; // SD at index 1
      }
    }

    const modelOutput: ModelOutput = {predictions, nFrames, nClasses};
    const events = pickPeaksFromModelOutput(modelOutput);

    expect(events.length).toBeGreaterThanOrEqual(2);

    const bdEvents = events.filter(e => e.drumClass === 'BD');
    const sdEvents = events.filter(e => e.drumClass === 'SD');
    expect(bdEvents.length).toBeGreaterThanOrEqual(1);
    expect(sdEvents.length).toBeGreaterThanOrEqual(1);

    expect(bdEvents[0].timeSeconds).toBeCloseTo(1.0, 1);
    expect(sdEvents[0].timeSeconds).toBeCloseTo(2.0, 1);
  });

  it('events are sorted by time', () => {
    const nFrames = 500;
    const nClasses = NUM_DRUM_CLASSES;
    const predictions = new Float32Array(nFrames * nClasses);

    const placements = [
      {frame: 300, cls: 0, value: 0.8}, // BD at 3s
      {frame: 100, cls: 1, value: 0.9}, // SD at 1s
      {frame: 200, cls: 5, value: 0.7}, // HH at 2s
    ];

    for (const p of placements) {
      predictions[p.frame * nClasses + p.cls] = p.value;
    }

    const modelOutput: ModelOutput = {predictions, nFrames, nClasses};
    const events = pickPeaksFromModelOutput(modelOutput);

    for (let i = 1; i < events.length; i++) {
      expect(events[i].timeSeconds).toBeGreaterThanOrEqual(
        events[i - 1].timeSeconds,
      );
    }
  });

  it('returns empty for silent model output', () => {
    const nFrames = 100;
    const nClasses = NUM_DRUM_CLASSES;
    const predictions = new Float32Array(nFrames * nClasses);

    const modelOutput: ModelOutput = {predictions, nFrames, nClasses};
    const events = pickPeaksFromModelOutput(modelOutput);
    expect(events.length).toBe(0);
  });

  it('events have correct MIDI pitch mappings for all 9 classes', () => {
    const nFrames = 1000;
    const nClasses = NUM_DRUM_CLASSES;
    const predictions = new Float32Array(nFrames * nClasses);

    // Expected MIDI pitches for the 9 CRNN classes
    const expectedPitches = [36, 38, 50, 47, 43, 42, 49, 57, 51];
    for (let cls = 0; cls < nClasses; cls++) {
      const frame = 50 + cls * 100; // Widely spaced
      predictions[frame * nClasses + cls] = 0.9;
    }

    const modelOutput: ModelOutput = {predictions, nFrames, nClasses};
    const events = pickPeaksFromModelOutput(modelOutput);

    for (let cls = 0; cls < nClasses; cls++) {
      const classEvents = events.filter(
        e => e.midiPitch === expectedPitches[cls],
      );
      expect(classEvents.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('respects per-class thresholds', () => {
    const nFrames = 300;
    const nClasses = NUM_DRUM_CLASSES;
    const predictions = new Float32Array(nFrames * nClasses);

    // BD threshold is 0.25, HT threshold is 0.3
    // Place a peak at 0.27 for both BD (index 0) and HT (index 2)
    predictions[100 * nClasses + 0] = 0.27; // BD: above 0.25 threshold
    predictions[100 * nClasses + 2] = 0.27; // HT: below 0.3 threshold

    const modelOutput: ModelOutput = {predictions, nFrames, nClasses};
    const events = pickPeaksFromModelOutput(modelOutput);

    const bdEvents = events.filter(e => e.drumClass === 'BD');
    const htEvents = events.filter(e => e.drumClass === 'HT');
    expect(bdEvents.length).toBeGreaterThanOrEqual(1);
    expect(htEvents.length).toBe(0);
  });
});
