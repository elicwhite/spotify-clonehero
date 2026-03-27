/**
 * Tests for the mel spectrogram computation.
 */

import {
  computeMelSpectrogram,
  createMelFilterbank,
  hzToMel,
  melToHz,
} from '../ml/spectrogram';
import {DEFAULT_MEL_CONFIG} from '../ml/types';

describe('hzToMel / melToHz', () => {
  it('round-trips correctly', () => {
    const freqs = [0, 100, 440, 1000, 8000, 22050];
    for (const hz of freqs) {
      expect(melToHz(hzToMel(hz))).toBeCloseTo(hz, 2);
    }
  });

  it('hzToMel(0) = 0', () => {
    expect(hzToMel(0)).toBe(0);
  });

  it('mel increases monotonically with Hz', () => {
    let prev = -1;
    for (let hz = 0; hz <= 22050; hz += 100) {
      const mel = hzToMel(hz);
      expect(mel).toBeGreaterThan(prev);
      prev = mel;
    }
  });
});

describe('createMelFilterbank', () => {
  it('produces correct number of filters', () => {
    const filters = createMelFilterbank(2048, 44100, 128, 0, 22050);
    expect(filters.length).toBe(128);
  });

  it('filters have correct length (nFft/2 + 1)', () => {
    const filters = createMelFilterbank(2048, 44100, 128, 0, 22050);
    for (const filter of filters) {
      expect(filter.length).toBe(1025);
    }
  });

  it('filters are non-negative', () => {
    const filters = createMelFilterbank(2048, 44100, 128, 0, 22050);
    for (const filter of filters) {
      for (let i = 0; i < filter.length; i++) {
        expect(filter[i]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('each filter has at least one non-zero bin', () => {
    const filters = createMelFilterbank(2048, 44100, 128, 0, 22050);
    for (const filter of filters) {
      const sum = filter.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThan(0);
    }
  });
});

describe('computeMelSpectrogram', () => {
  it('returns correct shape for known input length', () => {
    // 1 second at 44100 Hz = 44100 samples
    // nFrames = floor((44100 - 2048) / 441) + 1 = 96
    const audio = new Float32Array(44100);
    const {spectrogram, nFrames, nMels} = computeMelSpectrogram(audio);

    expect(nMels).toBe(128);
    expect(nFrames).toBe(Math.floor((44100 - 2048) / 441) + 1);
    expect(spectrogram.length).toBe(nFrames * nMels);
  });

  it('produces finite values', () => {
    const audio = new Float32Array(44100);
    // Fill with a 440 Hz sine wave
    for (let i = 0; i < audio.length; i++) {
      audio[i] = Math.sin((2 * Math.PI * 440 * i) / 44100);
    }

    const {spectrogram, nFrames, nMels} = computeMelSpectrogram(audio);

    for (let i = 0; i < spectrogram.length; i++) {
      expect(isFinite(spectrogram[i])).toBe(true);
    }
  });

  it('returns empty for too-short audio', () => {
    const audio = new Float32Array(100); // Way too short for a single frame
    const {spectrogram, nFrames} = computeMelSpectrogram(audio);

    expect(nFrames).toBe(0);
    expect(spectrogram.length).toBe(0);
  });

  it('silence produces low (negative log) values', () => {
    const audio = new Float32Array(44100); // all zeros
    const {spectrogram} = computeMelSpectrogram(audio);

    // log(0 + 1e-6) ≈ -13.8
    for (let i = 0; i < spectrogram.length; i++) {
      expect(spectrogram[i]).toBeLessThan(0);
    }
  });
});
