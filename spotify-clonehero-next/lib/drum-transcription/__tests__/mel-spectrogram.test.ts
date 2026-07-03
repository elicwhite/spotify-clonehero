/**
 * Unit tests for the CRNN mel spectrogram computation (48 kHz pipeline).
 *
 * Numeric equivalence with the reference pipeline is covered by
 * mel-reference.test.ts; these tests cover shapes, layouts, and edge cases.
 */

import {
  computeMelChannel,
  computeStereoMel,
  computeMonoMelTMajor,
  createMelFilterbank,
  hzToMel,
  melToHz,
} from '../ml/spectrogram';
import {DEFAULT_MEL_CONFIG} from '../ml/types';

describe('hzToMel / melToHz', () => {
  it('round-trips correctly', () => {
    const freqs = [0, 100, 440, 1000, 8000, 24000];
    for (const hz of freqs) {
      expect(melToHz(hzToMel(hz))).toBeCloseTo(hz, 2);
    }
  });

  it('hzToMel(0) = 0', () => {
    expect(hzToMel(0)).toBe(0);
  });

  it('mel increases monotonically with Hz', () => {
    let prev = -1;
    for (let hz = 0; hz <= 24000; hz += 100) {
      const mel = hzToMel(hz);
      expect(mel).toBeGreaterThan(prev);
      prev = mel;
    }
  });
});

describe('createMelFilterbank (CRNN config: 1024 fft, 48 kHz, 256 mels)', () => {
  const filters = createMelFilterbank(1024, 48000, 256, 0, 24000);

  it('produces 256 filters of length nFft/2 + 1 = 513', () => {
    expect(filters.length).toBe(256);
    for (const filter of filters) {
      expect(filter.length).toBe(513);
    }
  });

  it('filters are non-negative and not normalized (peak close to 1)', () => {
    let globalMax = 0;
    for (const filter of filters) {
      for (let i = 0; i < filter.length; i++) {
        expect(filter[i]).toBeGreaterThanOrEqual(0);
        globalMax = Math.max(globalMax, filter[i]);
      }
    }
    // Unnormalized triangles: the tallest weight across the bank is ~1.
    expect(globalMax).toBeGreaterThan(0.9);
    expect(globalMax).toBeLessThanOrEqual(1);
  });
});

describe('computeMelChannel', () => {
  it('returns m-major (nMels, T) with no-center frame count', () => {
    // 1 second at 48 kHz: nFrames = 1 + floor((48000 - 1024) / 480) = 98
    const audio = new Float32Array(48000);
    const {mel, nFrames, nMels} = computeMelChannel(audio);

    expect(nMels).toBe(256);
    expect(nFrames).toBe(1 + Math.floor((48000 - 1024) / 480));
    expect(mel.length).toBe(nMels * nFrames);
  });

  it('produces finite values for a sine wave', () => {
    const audio = new Float32Array(48000);
    for (let i = 0; i < audio.length; i++) {
      audio[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }
    const {mel} = computeMelChannel(audio);
    for (let i = 0; i < mel.length; i++) {
      expect(isFinite(mel[i])).toBe(true);
    }
  });

  it('silence produces log(1e-6)', () => {
    const audio = new Float32Array(4800);
    const {mel} = computeMelChannel(audio);
    for (let i = 0; i < mel.length; i++) {
      expect(mel[i]).toBeCloseTo(Math.log(1e-6), 4);
    }
  });

  it('returns empty for too-short audio', () => {
    const audio = new Float32Array(100);
    const {mel, nFrames} = computeMelChannel(audio);
    expect(nFrames).toBe(0);
    expect(mel.length).toBe(0);
  });
});

describe('computeStereoMel / computeMonoMelTMajor', () => {
  it('lays out channels as [ch][m][t] and mono as [t][m]', () => {
    const n = 48000 / 2;
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      left[i] = Math.sin((2 * Math.PI * 200 * i) / 48000);
      right[i] = Math.sin((2 * Math.PI * 4000 * i) / 48000);
    }

    const {melStereo, nFrames, nMels} = computeStereoMel(left, right);
    expect(nMels).toBe(256);
    expect(melStereo.length).toBe(2 * nMels * nFrames);

    // Each channel block should equal computeMelChannel of that channel.
    const {mel: melL} = computeMelChannel(left);
    const {mel: melR} = computeMelChannel(right);
    for (let i = 0; i < nMels * nFrames; i++) {
      expect(melStereo[i]).toBe(melL[i]);
      expect(melStereo[nMels * nFrames + i]).toBe(melR[i]);
    }

    // Mono is the per-(t, m) mean of L and R, time-major.
    const mono = computeMonoMelTMajor(melStereo, nFrames, nMels);
    expect(mono.length).toBe(nFrames * nMels);
    for (let t = 0; t < nFrames; t += 7) {
      for (let m = 0; m < nMels; m += 31) {
        const expected = Math.fround(
          Math.fround(melL[m * nFrames + t] + melR[m * nFrames + t]) / 2,
        );
        expect(mono[t * nMels + m]).toBe(expected);
      }
    }
  });

  it('uses the DEFAULT_MEL_CONFIG 48 kHz parameters', () => {
    expect(DEFAULT_MEL_CONFIG).toEqual({
      sampleRate: 48000,
      nFft: 1024,
      hopLength: 480,
      nMels: 256,
      fMin: 0,
      fMax: 24000,
    });
  });
});
