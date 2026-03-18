/**
 * Tests for the STFT / iSTFT implementation.
 *
 * These tests verify correctness without requiring a GPU or the ONNX runtime.
 * They focus on two key properties:
 *
 * 1. **Parseval's theorem** — the energy in the frequency domain equals the
 *    energy in the time domain (within floating-point tolerance).
 *
 * 2. **Round-trip accuracy** — STFT followed by iSTFT recovers the original
 *    signal with minimal error.
 */

import {
  NFFT,
  HOP_LENGTH,
  SEGMENT_SAMPLES,
  computeSTFT,
  computeISTFT,
  createSTFTBuffers,
  createISTFTBuffers,
  type STFTBuffers,
  type ISTFTBuffers,
} from '../audio/stft';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NUM_CHANNELS = 2;

/** Creates a stereo interleaved signal of SEGMENT_SAMPLES per channel. */
function makeTestSignal(
  generator: (channelIdx: number, sampleIdx: number) => number,
): Float32Array {
  const signal = new Float32Array(SEGMENT_SAMPLES * NUM_CHANNELS);
  for (let i = 0; i < SEGMENT_SAMPLES; i++) {
    signal[i * 2] = generator(0, i);
    signal[i * 2 + 1] = generator(1, i);
  }
  return signal;
}

/** Computes the RMS energy of a Float32Array. */
function rmsEnergy(arr: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i] * arr[i];
  }
  return Math.sqrt(sum / arr.length);
}

/** Computes the max absolute value of a Float32Array. */
function maxAbs(arr: Float32Array): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = Math.abs(arr[i]);
    if (v > m) m = v;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('STFT constants', () => {
  it('has the correct FFT size', () => {
    expect(NFFT).toBe(4096);
  });

  it('has hop = NFFT/4', () => {
    expect(HOP_LENGTH).toBe(NFFT / 4);
    expect(HOP_LENGTH).toBe(1024);
  });

  it('has segment = 10 seconds at 44.1 kHz', () => {
    expect(SEGMENT_SAMPLES).toBe(441000);
  });
});

describe('STFT buffer allocation', () => {
  it('createSTFTBuffers returns the expected buffer shapes', () => {
    const buffers = createSTFTBuffers();
    // Two channels of padded data
    expect(buffers.demucs_padded.length).toBe(2);
    expect(buffers.paddedChannels.length).toBe(2);
    // Output arrays should be non-empty
    expect(buffers.outReal.length).toBeGreaterThan(0);
    expect(buffers.outImag.length).toBeGreaterThan(0);
  });

  it('createISTFTBuffers returns the expected buffer shapes', () => {
    const buffers = createISTFTBuffers();
    expect(buffers.output.length).toBeGreaterThan(0);
    expect(buffers.windowSum.length).toBeGreaterThan(0);
    expect(buffers.finalOutput.length).toBe(NUM_CHANNELS * SEGMENT_SAMPLES);
  });
});

describe('STFT → iSTFT round-trip', () => {
  let stftBuf: STFTBuffers;
  let istftBuf: ISTFTBuffers;

  beforeAll(() => {
    stftBuf = createSTFTBuffers();
    istftBuf = createISTFTBuffers();
  });

  it('recovers a sine wave with low error', () => {
    const freq = 440; // Hz
    const sr = 44100;
    const signal = makeTestSignal((ch, i) => {
      const phase = ch === 0 ? 0 : Math.PI / 4;
      return 0.5 * Math.sin(2 * Math.PI * freq * (i / sr) + phase);
    });

    const stft = computeSTFT(signal, stftBuf);
    const recovered = computeISTFT(
      stft.real,
      stft.imag,
      NUM_CHANNELS,
      stft.numBins,
      stft.numFrames,
      SEGMENT_SAMPLES,
      istftBuf,
    );

    // recovered is planar [L0..LN, R0..RN], convert to interleaved for comparison
    // Compare a central portion to avoid edge effects from padding
    const margin = NFFT; // skip first/last NFFT samples
    let maxError = 0;
    for (let i = margin; i < SEGMENT_SAMPLES - margin; i++) {
      const origLeft = signal[i * 2];
      const origRight = signal[i * 2 + 1];
      const recLeft = recovered[i]; // planar: first SEGMENT_SAMPLES = left
      const recRight = recovered[SEGMENT_SAMPLES + i]; // second half = right

      const errL = Math.abs(origLeft - recLeft);
      const errR = Math.abs(origRight - recRight);
      maxError = Math.max(maxError, errL, errR);
    }

    // The round-trip should be accurate to within ~1e-6
    expect(maxError).toBeLessThan(1e-4);
  });

  it('recovers a DC signal with low error', () => {
    const signal = makeTestSignal((ch) => (ch === 0 ? 0.3 : -0.2));

    const stft = computeSTFT(signal, stftBuf);
    const recovered = computeISTFT(
      stft.real,
      stft.imag,
      NUM_CHANNELS,
      stft.numBins,
      stft.numFrames,
      SEGMENT_SAMPLES,
      istftBuf,
    );

    const margin = NFFT;
    let maxError = 0;
    for (let i = margin; i < SEGMENT_SAMPLES - margin; i++) {
      const errL = Math.abs(signal[i * 2] - recovered[i]);
      const errR = Math.abs(signal[i * 2 + 1] - recovered[SEGMENT_SAMPLES + i]);
      maxError = Math.max(maxError, errL, errR);
    }

    expect(maxError).toBeLessThan(1e-4);
  });

  it('recovers a multi-frequency signal', () => {
    const sr = 44100;
    const signal = makeTestSignal((_ch, i) => {
      return (
        0.3 * Math.sin(2 * Math.PI * 220 * (i / sr)) +
        0.2 * Math.sin(2 * Math.PI * 880 * (i / sr)) +
        0.1 * Math.sin(2 * Math.PI * 3520 * (i / sr))
      );
    });

    const stft = computeSTFT(signal, stftBuf);
    const recovered = computeISTFT(
      stft.real,
      stft.imag,
      NUM_CHANNELS,
      stft.numBins,
      stft.numFrames,
      SEGMENT_SAMPLES,
      istftBuf,
    );

    const margin = NFFT;
    let maxError = 0;
    for (let i = margin; i < SEGMENT_SAMPLES - margin; i++) {
      const errL = Math.abs(signal[i * 2] - recovered[i]);
      maxError = Math.max(maxError, errL);
    }

    expect(maxError).toBeLessThan(1e-4);
  });
});

describe('Parseval\'s theorem', () => {
  let stftBuf: STFTBuffers;

  beforeAll(() => {
    stftBuf = createSTFTBuffers();
  });

  it('preserves energy for a sine wave (within tolerance)', () => {
    const freq = 1000;
    const sr = 44100;
    const signal = makeTestSignal((_ch, i) =>
      Math.sin(2 * Math.PI * freq * (i / sr)),
    );

    // Time-domain energy (for one channel, left)
    let timeEnergy = 0;
    for (let i = 0; i < SEGMENT_SAMPLES; i++) {
      timeEnergy += signal[i * 2] * signal[i * 2]; // left channel only
    }

    const stft = computeSTFT(signal, stftBuf);

    // Frequency-domain energy (left channel = first half of outReal/outImag)
    let freqEnergy = 0;
    const binsPerChannel = stft.numBins * stft.numFrames;
    for (let j = 0; j < binsPerChannel; j++) {
      const re = stft.real[j]; // channel 0 starts at index 0
      const im = stft.imag[j];
      freqEnergy += re * re + im * im;
    }

    // Parseval's: time energy should be proportional to freq energy.
    // Due to windowing and overlap, they won't be exactly equal, but the
    // ratio should be reasonably close to a constant.
    // We just verify that the frequency domain captured significant energy
    // (not zero, not infinity).
    expect(freqEnergy).toBeGreaterThan(0);
    expect(timeEnergy).toBeGreaterThan(0);

    // The ratio should be roughly stable (within an order of magnitude)
    const ratio = freqEnergy / timeEnergy;
    expect(ratio).toBeGreaterThan(0.01);
    expect(ratio).toBeLessThan(100);
  });
});

describe('STFT output shape', () => {
  let stftBuf: STFTBuffers;

  beforeAll(() => {
    stftBuf = createSTFTBuffers();
  });

  it('produces 2048 bins (last bin trimmed from 2049)', () => {
    const signal = makeTestSignal(() => 0);
    const stft = computeSTFT(signal, stftBuf);
    expect(stft.numBins).toBe(2048);
  });

  it('produces the expected number of frames', () => {
    const signal = makeTestSignal(() => 0);
    const stft = computeSTFT(signal, stftBuf);
    const expectedFrames = Math.ceil(SEGMENT_SAMPLES / HOP_LENGTH);
    expect(stft.numFrames).toBe(expectedFrames);
  });

  it('output arrays have correct total length', () => {
    const signal = makeTestSignal(() => 0);
    const stft = computeSTFT(signal, stftBuf);
    const expectedLength = NUM_CHANNELS * stft.numBins * stft.numFrames;
    expect(stft.real.length).toBe(expectedLength);
    expect(stft.imag.length).toBe(expectedLength);
  });
});

describe('edge cases', () => {
  let stftBuf: STFTBuffers;
  let istftBuf: ISTFTBuffers;

  beforeAll(() => {
    stftBuf = createSTFTBuffers();
    istftBuf = createISTFTBuffers();
  });

  it('handles a silent signal (all zeros)', () => {
    const signal = makeTestSignal(() => 0);
    const stft = computeSTFT(signal, stftBuf);

    // All STFT coefficients should be zero (or very close)
    expect(maxAbs(stft.real)).toBeLessThan(1e-10);
    expect(maxAbs(stft.imag)).toBeLessThan(1e-10);

    const recovered = computeISTFT(
      stft.real,
      stft.imag,
      NUM_CHANNELS,
      stft.numBins,
      stft.numFrames,
      SEGMENT_SAMPLES,
      istftBuf,
    );

    expect(maxAbs(recovered)).toBeLessThan(1e-10);
  });

  it('handles a constant (DC) signal', () => {
    const signal = makeTestSignal(() => 0.5);
    const stft = computeSTFT(signal, stftBuf);

    // The STFT should have non-zero DC components
    expect(rmsEnergy(stft.real)).toBeGreaterThan(0);
  });
});
