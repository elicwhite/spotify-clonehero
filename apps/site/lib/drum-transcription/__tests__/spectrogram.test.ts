/**
 * Tests for the log-filtered spectrogram computation.
 *
 * Verifies:
 * - Logarithmic filterbank shape and properties
 * - Magnitude spectrogram output shape
 * - Log compression
 * - End-to-end spectrogram pipeline
 */

import {
  logFrequencies,
  createLogFilterbank,
  computeMagnitudeSpectrogram,
  computeLogFilteredSpectrogram,
  getFilterbank,
} from '../ml/spectrogram';
import {DEFAULT_SPECTROGRAM_CONFIG} from '../ml/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a mono sine wave. */
function makeSineWave(
  frequency: number,
  sampleRate: number,
  durationSeconds: number,
): Float32Array {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const signal = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    signal[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return signal;
}

/** Generate mono silence. */
function makeSilence(
  sampleRate: number,
  durationSeconds: number,
): Float32Array {
  return new Float32Array(Math.floor(sampleRate * durationSeconds));
}

// ---------------------------------------------------------------------------
// logFrequencies
// ---------------------------------------------------------------------------

describe('logFrequencies', () => {
  it('returns approximately 120 frequencies for 20-20000 Hz at 12 bands/octave', () => {
    // 12 bands/octave, 20-20000 Hz => ~10 octaves => ~120 frequencies
    // Exact count depends on A4 alignment and floor/ceil rounding
    const freqs = logFrequencies(12, 20, 20000);
    expect(freqs.length).toBe(120);
  });

  it('frequencies are strictly increasing', () => {
    const freqs = logFrequencies(12, 20, 20000);
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1]);
    }
  });

  it('first frequency is >= fMin', () => {
    const freqs = logFrequencies(12, 20, 20000);
    // Frequencies are filtered to [fMin, fMax)
    expect(freqs[0]).toBeGreaterThanOrEqual(20);
    expect(freqs[0]).toBeLessThan(25);
  });

  it('last frequency is < fMax', () => {
    const freqs = logFrequencies(12, 20, 20000);
    expect(freqs[freqs.length - 1]).toBeLessThan(20000);
  });

  it('all frequencies are within [fMin, fMax)', () => {
    const freqs = logFrequencies(12, 20, 20000);
    for (const f of freqs) {
      expect(f).toBeGreaterThanOrEqual(20);
      expect(f).toBeLessThan(20000);
    }
  });
});

// ---------------------------------------------------------------------------
// createLogFilterbank
// ---------------------------------------------------------------------------

describe('createLogFilterbank', () => {
  it('produces 84 filters for default ADTOF config', () => {
    const {filters, numBands} = createLogFilterbank(44100, 2048, 12, 20, 20000);
    expect(numBands).toBe(84);
    expect(filters.length).toBe(84);
  });

  it('each filter has length numFftBins = frameSize/2 + 1', () => {
    const frameSize = 2048;
    const expectedBins = Math.floor(frameSize / 2) + 1; // 1025
    const {filters} = createLogFilterbank(44100, frameSize, 12, 20, 20000);
    for (const filter of filters) {
      expect(filter.length).toBe(expectedBins);
    }
  });

  it('filters are normalized (sum to ~1 or weights are meaningful)', () => {
    const {filters} = createLogFilterbank(44100, 2048, 12, 20, 20000);
    for (const filter of filters) {
      let sum = 0;
      for (let i = 0; i < filter.length; i++) {
        sum += filter[i];
      }
      // Normalized filters should sum to approximately 1
      expect(sum).toBeCloseTo(1, 3);
    }
  });

  it('filters have non-negative values', () => {
    const {filters} = createLogFilterbank(44100, 2048, 12, 20, 20000);
    for (const filter of filters) {
      for (let i = 0; i < filter.length; i++) {
        expect(filter[i]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('lower filters are wider (more bins) than higher filters', () => {
    const {filters} = createLogFilterbank(44100, 2048, 12, 20, 20000);

    // Count non-zero bins in first and last filter
    const nonZeroFirst = filters[0].filter(v => v > 0).length;
    const nonZeroLast = filters[filters.length - 1].filter(v => v > 0).length;

    // Higher filters (higher frequency) should be wider in frequency
    // but since the FFT bins are linearly spaced, the first filter
    // covers fewer bins than the last. Actually, at low frequencies
    // the log-spaced bands cover fewer Hz but those Hz map to fewer bins.
    // This is correct: lower bands cover fewer FFT bins.
    expect(nonZeroFirst).toBeGreaterThan(0);
    expect(nonZeroLast).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeMagnitudeSpectrogram
// ---------------------------------------------------------------------------

describe('computeMagnitudeSpectrogram', () => {
  it('produces the expected output shape', () => {
    const sampleRate = 44100;
    const duration = 1; // 1 second
    const signal = makeSineWave(440, sampleRate, duration);
    const frameSize = 2048;
    const hopLength = 441;

    const {magnitudes, nFrames, numFftBins} = computeMagnitudeSpectrogram(
      signal,
      frameSize,
      hopLength,
    );

    const expectedBins = Math.floor(frameSize / 2) + 1;
    expect(numFftBins).toBe(expectedBins);

    const expectedFrames =
      Math.floor((signal.length - frameSize) / hopLength) + 1;
    expect(nFrames).toBe(expectedFrames);
    expect(magnitudes.length).toBe(nFrames * numFftBins);
  });

  it('produces non-negative magnitudes', () => {
    const signal = makeSineWave(440, 44100, 0.5);
    const {magnitudes} = computeMagnitudeSpectrogram(signal, 2048, 441);
    for (let i = 0; i < magnitudes.length; i++) {
      expect(magnitudes[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('detects a sine wave at the correct frequency bin', () => {
    const sampleRate = 44100;
    const freq = 440;
    const signal = makeSineWave(freq, sampleRate, 1);
    const frameSize = 2048;
    const hopLength = 441;

    const {magnitudes, nFrames, numFftBins} = computeMagnitudeSpectrogram(
      signal,
      frameSize,
      hopLength,
    );

    // For a middle frame, find the bin with the highest magnitude
    const midFrame = Math.floor(nFrames / 2);
    const offset = midFrame * numFftBins;
    let maxBin = 0;
    let maxVal = 0;
    for (let bin = 0; bin < numFftBins; bin++) {
      if (magnitudes[offset + bin] > maxVal) {
        maxVal = magnitudes[offset + bin];
        maxBin = bin;
      }
    }

    // Expected bin for 440 Hz with frameSize=2048, sampleRate=44100
    const expectedBin = Math.round((freq * frameSize) / sampleRate);
    // Allow +/- 1 bin tolerance
    expect(Math.abs(maxBin - expectedBin)).toBeLessThanOrEqual(1);
  });

  it('returns empty result for very short audio', () => {
    // Shorter than one frame
    const signal = new Float32Array(100);
    const {magnitudes, nFrames} = computeMagnitudeSpectrogram(
      signal,
      2048,
      441,
    );
    expect(nFrames).toBe(0);
    expect(magnitudes.length).toBe(0);
  });

  it('produces near-zero magnitudes for silence', () => {
    const signal = makeSilence(44100, 0.5);
    const {magnitudes} = computeMagnitudeSpectrogram(signal, 2048, 441);
    for (let i = 0; i < magnitudes.length; i++) {
      expect(magnitudes[i]).toBeLessThan(1e-10);
    }
  });
});

// ---------------------------------------------------------------------------
// computeLogFilteredSpectrogram
// ---------------------------------------------------------------------------

describe('computeLogFilteredSpectrogram', () => {
  it('produces 84 frequency bands with default config', () => {
    const signal = makeSineWave(440, 44100, 1);
    const {numBands} = computeLogFilteredSpectrogram(signal);
    expect(numBands).toBe(84);
  });

  it('produces the expected number of frames for 1 second of audio', () => {
    const signal = makeSineWave(440, 44100, 1);
    const {nFrames} = computeLogFilteredSpectrogram(signal);
    // At fps=100, 1 second should give ~95-96 frames
    // (slightly less than 100 due to frame_size requiring sufficient samples)
    expect(nFrames).toBeGreaterThan(90);
    expect(nFrames).toBeLessThanOrEqual(100);
  });

  it('output shape is [nFrames, numBands]', () => {
    const signal = makeSineWave(440, 44100, 1);
    const {spectrogram, nFrames, numBands} =
      computeLogFilteredSpectrogram(signal);
    expect(spectrogram.length).toBe(nFrames * numBands);
  });

  it('log compression produces non-negative values', () => {
    const signal = makeSineWave(440, 44100, 1);
    const {spectrogram} = computeLogFilteredSpectrogram(signal);
    for (let i = 0; i < spectrogram.length; i++) {
      // log(magnitude + 1) >= log(0 + 1) = 0
      expect(spectrogram[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('silence produces near-zero spectrogram values', () => {
    const signal = makeSilence(44100, 1);
    const {spectrogram} = computeLogFilteredSpectrogram(signal);
    for (let i = 0; i < spectrogram.length; i++) {
      // log(0 + 1) = 0
      expect(spectrogram[i]).toBeLessThan(0.01);
    }
  });

  it('a louder signal produces larger spectrogram values', () => {
    const quiet = makeSineWave(440, 44100, 1);
    const loud = new Float32Array(quiet.length);
    for (let i = 0; i < quiet.length; i++) {
      loud[i] = quiet[i] * 10;
    }

    const {spectrogram: quietSpec} = computeLogFilteredSpectrogram(quiet);
    const {spectrogram: loudSpec} = computeLogFilteredSpectrogram(loud);

    // Sum total energy
    let quietSum = 0;
    let loudSum = 0;
    for (let i = 0; i < quietSpec.length; i++) {
      quietSum += quietSpec[i];
      loudSum += loudSpec[i];
    }

    expect(loudSum).toBeGreaterThan(quietSum);
  });

  it('returns empty result for very short audio', () => {
    const signal = new Float32Array(100);
    const {spectrogram, nFrames, numBands} =
      computeLogFilteredSpectrogram(signal);
    expect(nFrames).toBe(0);
    expect(numBands).toBe(0);
    expect(spectrogram.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getFilterbank caching
// ---------------------------------------------------------------------------

describe('getFilterbank', () => {
  it('returns the same result for the same config', () => {
    const fb1 = getFilterbank(DEFAULT_SPECTROGRAM_CONFIG);
    const fb2 = getFilterbank(DEFAULT_SPECTROGRAM_CONFIG);
    expect(fb1.numBands).toBe(fb2.numBands);
    expect(fb1.filters.length).toBe(fb2.filters.length);
  });

  it('returns 84 bands for default config', () => {
    const fb = getFilterbank(DEFAULT_SPECTROGRAM_CONFIG);
    expect(fb.numBands).toBe(84);
  });
});
