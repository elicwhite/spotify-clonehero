/**
 * Tests for the panning feature computation.
 */

import {computePanningFeatures} from '../ml/panning';
import {DEFAULT_MEL_CONFIG} from '../ml/types';

describe('computePanningFeatures', () => {
  it('returns correct shape', () => {
    // 1 second stereo = 88200 samples interleaved
    const stereo = new Float32Array(88200);
    const {panning, nFrames} = computePanningFeatures(stereo);

    const expectedFrames = Math.floor((44100 - 2048) / 441) + 1;
    expect(nFrames).toBe(expectedFrames);
    expect(panning.length).toBe(4 * nFrames);
  });

  it('mono signal (L == R) produces near-zero panning', () => {
    const numSamples = 44100;
    const stereo = new Float32Array(numSamples * 2);
    // Same 440 Hz sine on both channels
    for (let i = 0; i < numSamples; i++) {
      const val = Math.sin((2 * Math.PI * 440 * i) / 44100);
      stereo[i * 2] = val;
      stereo[i * 2 + 1] = val;
    }

    const {panning, nFrames} = computePanningFeatures(stereo);

    // All bands should be near 0 (equal L and R)
    for (let b = 0; b < 4; b++) {
      for (let f = 0; f < nFrames; f++) {
        expect(Math.abs(panning[b * nFrames + f])).toBeLessThan(0.01);
      }
    }
  });

  it('left-only signal produces negative panning', () => {
    const numSamples = 44100;
    const stereo = new Float32Array(numSamples * 2);
    // Signal only on left channel
    for (let i = 0; i < numSamples; i++) {
      stereo[i * 2] = Math.sin((2 * Math.PI * 1000 * i) / 44100);
      stereo[i * 2 + 1] = 0;
    }

    const {panning, nFrames} = computePanningFeatures(stereo);

    // At least one band covering 1000 Hz (band 1: 300-3000 Hz) should be negative
    let foundNegative = false;
    for (let f = 0; f < nFrames; f++) {
      if (panning[1 * nFrames + f] < -0.5) {
        foundNegative = true;
        break;
      }
    }
    expect(foundNegative).toBe(true);
  });

  it('right-only signal produces positive panning', () => {
    const numSamples = 44100;
    const stereo = new Float32Array(numSamples * 2);
    // Signal only on right channel
    for (let i = 0; i < numSamples; i++) {
      stereo[i * 2] = 0;
      stereo[i * 2 + 1] = Math.sin((2 * Math.PI * 1000 * i) / 44100);
    }

    const {panning, nFrames} = computePanningFeatures(stereo);

    // Band 1 (300-3000 Hz) should be positive
    let foundPositive = false;
    for (let f = 0; f < nFrames; f++) {
      if (panning[1 * nFrames + f] > 0.5) {
        foundPositive = true;
        break;
      }
    }
    expect(foundPositive).toBe(true);
  });

  it('returns empty for too-short audio', () => {
    const stereo = new Float32Array(100);
    const {panning, nFrames} = computePanningFeatures(stereo);

    expect(nFrames).toBe(0);
    expect(panning.length).toBe(0);
  });
});
