/**
 * STFT / iSTFT for the Demucs stem-separation pipeline.
 *
 * Uses webfft (WASM-accelerated FFT) to compute the Short-Time Fourier Transform and
 * its inverse. The parameters and padding logic exactly match PyTorch's
 * `torch.stft` / `torch.istft` as used by the Demucs ONNX model.
 *
 * Reference implementation: ~/projects/demucs-next/web/src/utils/audio-processor.ts
 *
 * Key parameters:
 *   NFFT        = 4096
 *   HOP_LENGTH  = 1024  (NFFT / 4)
 *   Window      = Hann(4096), periodic
 *   Normalisation = 1/sqrt(NFFT)  (orthonormal)
 *
 * The STFT output has the last frequency bin removed (2049 -> 2048) to match
 * what the ONNX Demucs model expects.
 */

import WebFFT from 'webfft';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** FFT size. */
export const NFFT = 4096;

/** Hop length between successive STFT frames. */
export const HOP_LENGTH = NFFT / 4; // 1024

/** Number of samples in a 10-second segment at 44.1 kHz. */
export const SEGMENT_SAMPLES = 441000;

/** Number of stereo channels. */
const NUM_CHANNELS = 2;

// Derived constants (match demucs-next exactly)
const LE = Math.ceil(SEGMENT_SAMPLES / HOP_LENGTH);
const DEMUCS_PAD = Math.floor(HOP_LENGTH / 2) * 3; // 1536
const DEMUCS_PAD_RIGHT = DEMUCS_PAD + LE * HOP_LENGTH - SEGMENT_SAMPLES;
const DEMUCS_PADDED_LENGTH = DEMUCS_PAD + SEGMENT_SAMPLES + DEMUCS_PAD_RIGHT;
const CENTER_PAD = NFFT / 2; // 2048
const PADDED_LENGTH = DEMUCS_PADDED_LENGTH + 2 * CENTER_PAD;
const RAW_FRAMES = Math.floor((PADDED_LENGTH - NFFT) / HOP_LENGTH) + 1;
const NUM_BINS = NFFT / 2 + 1; // 2049
const OUT_BINS = NUM_BINS - 1; // 2048 (last bin trimmed)
const OUT_FRAMES = LE;

// iSTFT constants
const ISTFT_PAD = Math.floor(HOP_LENGTH / 2) * 3; // 1536
const ISTFT_LE =
  HOP_LENGTH * Math.ceil(SEGMENT_SAMPLES / HOP_LENGTH) + 2 * ISTFT_PAD;

// Singleton FFT instance (WASM-accelerated via webfft)
const fftInstance = new WebFFT(NFFT);

// Pre-computed Hann window (periodic)
const hannWindow = new Float32Array(NFFT);
for (let i = 0; i < NFFT; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / NFFT));
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of a forward STFT. */
export interface STFTResult {
  real: Float32Array;
  imag: Float32Array;
  numBins: number;
  numFrames: number;
}

/** Pre-allocated buffers for the forward STFT. */
export interface STFTBuffers {
  demucs_padded: [Float32Array, Float32Array];
  paddedChannels: [Float32Array, Float32Array];
  real: Float32Array;
  imag: Float32Array;
  outReal: Float32Array;
  outImag: Float32Array;
  fftInput: Float32Array;
}

/** Pre-allocated buffers for the inverse STFT. */
export interface ISTFTBuffers {
  output: Float32Array;
  windowSum: Float32Array;
  finalOutput: Float32Array;
  ifftInput: Float32Array;
}

// ---------------------------------------------------------------------------
// Buffer factories (call once before the segment loop)
// ---------------------------------------------------------------------------

export function createSTFTBuffers(): STFTBuffers {
  return {
    demucs_padded: [
      new Float32Array(DEMUCS_PADDED_LENGTH),
      new Float32Array(DEMUCS_PADDED_LENGTH),
    ],
    paddedChannels: [
      new Float32Array(PADDED_LENGTH),
      new Float32Array(PADDED_LENGTH),
    ],
    real: new Float32Array(NUM_CHANNELS * NUM_BINS * RAW_FRAMES),
    imag: new Float32Array(NUM_CHANNELS * NUM_BINS * RAW_FRAMES),
    outReal: new Float32Array(NUM_CHANNELS * OUT_BINS * OUT_FRAMES),
    outImag: new Float32Array(NUM_CHANNELS * OUT_BINS * OUT_FRAMES),
    fftInput: new Float32Array(NFFT * 2),
  };
}

export function createISTFTBuffers(): ISTFTBuffers {
  return {
    output: new Float32Array(NUM_CHANNELS * ISTFT_LE),
    windowSum: new Float32Array(ISTFT_LE),
    finalOutput: new Float32Array(NUM_CHANNELS * SEGMENT_SAMPLES),
    ifftInput: new Float32Array(NFFT * 2),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reflect-pad index into range [0, len). Uses modular arithmetic instead of a loop. */
function reflectIndex(i: number, len: number): number {
  if (i >= 0 && i < len) return i;
  // Map into a period of length 2*(len-1), then fold
  const period = 2 * (len - 1);
  // Bring into [0, period)
  i = ((i % period) + period) % period;
  // Fold the second half back
  return i < len ? i : period - i;
}

// ---------------------------------------------------------------------------
// Forward STFT
// ---------------------------------------------------------------------------

/**
 * Compute the forward STFT of a segment of interleaved stereo audio.
 *
 * The input `audio` must be interleaved stereo with exactly
 * `SEGMENT_SAMPLES` samples per channel (total length = SEGMENT_SAMPLES * 2).
 *
 * Returns the real and imaginary STFT coefficients in the layout expected by
 * the Demucs ONNX model: `[channel, bin, frame]` flattened, with 2048 bins
 * and `LE` frames.
 */
export function computeSTFT(
  audio: Float32Array,
  buffers: STFTBuffers,
): STFTResult {
  const numSamples = audio.length / NUM_CHANNELS;
  const {
    demucs_padded,
    paddedChannels,
    real,
    imag,
    outReal,
    outImag,
    fftInput,
  } = buffers;

  // Clear buffers
  demucs_padded[0].fill(0);
  demucs_padded[1].fill(0);
  paddedChannels[0].fill(0);
  paddedChannels[1].fill(0);
  real.fill(0);
  imag.fill(0);
  outReal.fill(0);
  outImag.fill(0);

  // Step 1: Demucs reflect-padding (1536 samples on each side, with right
  // padding adjusted to align to hop boundaries)
  for (let c = 0; c < NUM_CHANNELS; c++) {
    for (let i = 0; i < DEMUCS_PADDED_LENGTH; i++) {
      const origIdx = i - DEMUCS_PAD;
      const srcIdx = reflectIndex(origIdx, numSamples);
      demucs_padded[c][i] = audio[srcIdx * NUM_CHANNELS + c];
    }
  }

  // Step 2: Center-padding for the STFT (NFFT/2 on each side, reflect)
  for (let c = 0; c < NUM_CHANNELS; c++) {
    for (let i = 0; i < PADDED_LENGTH; i++) {
      const origIdx = i - CENTER_PAD;
      if (origIdx >= 0 && origIdx < DEMUCS_PADDED_LENGTH) {
        paddedChannels[c][i] = demucs_padded[c][origIdx];
      } else {
        const srcIdx = reflectIndex(origIdx, DEMUCS_PADDED_LENGTH);
        paddedChannels[c][i] = demucs_padded[c][srcIdx];
      }
    }
  }

  // Step 3: Windowed FFT per frame
  const norm = 1.0 / Math.sqrt(NFFT);

  for (let c = 0; c < NUM_CHANNELS; c++) {
    const channelData = paddedChannels[c];

    for (let f = 0; f < RAW_FRAMES; f++) {
      const frameStart = f * HOP_LENGTH;

      // Apply Hann window and pack into complex input
      for (let i = 0; i < NFFT; i++) {
        const idx = frameStart + i;
        if (idx < PADDED_LENGTH) {
          fftInput[i * 2] = channelData[idx] * hannWindow[i];
        } else {
          fftInput[i * 2] = 0;
        }
        fftInput[i * 2 + 1] = 0;
      }

      const fftOutput = fftInstance.fft(fftInput);

      // Store only the first NUM_BINS (positive frequencies), normalised
      const binOffset = (c * RAW_FRAMES + f) * NUM_BINS;
      for (let k = 0; k < NUM_BINS; k++) {
        real[binOffset + k] = fftOutput[k * 2] * norm;
        imag[binOffset + k] = fftOutput[k * 2 + 1] * norm;
      }
    }
  }

  // Step 4: Trim to OUT_BINS x OUT_FRAMES and transpose to [c, bin, frame]
  // The raw frames are offset by +2 (matching the center-pad removal)
  for (let c = 0; c < NUM_CHANNELS; c++) {
    for (let f = 0; f < OUT_FRAMES; f++) {
      for (let b = 0; b < OUT_BINS; b++) {
        const srcIdx = (c * RAW_FRAMES + (f + 2)) * NUM_BINS + b;
        const dstIdx = c * OUT_BINS * OUT_FRAMES + b * OUT_FRAMES + f;
        outReal[dstIdx] = real[srcIdx];
        outImag[dstIdx] = imag[srcIdx];
      }
    }
  }

  return {real: outReal, imag: outImag, numBins: OUT_BINS, numFrames: OUT_FRAMES};
}

// ---------------------------------------------------------------------------
// Inverse STFT
// ---------------------------------------------------------------------------

/**
 * Compute the inverse STFT, producing a time-domain signal.
 *
 * @param real        - Real coefficients, layout `[channel, bin, frame]`.
 * @param imag        - Imaginary coefficients, same layout.
 * @param numChannels - Number of channels (2 for stereo).
 * @param numBins     - Number of frequency bins (2048).
 * @param numFrames   - Number of time frames.
 * @param targetLength - Number of output samples per channel (SEGMENT_SAMPLES).
 * @param buffers     - Pre-allocated ISTFTBuffers.
 *
 * Returns a Float32Array of shape `[channel, targetLength]` (channels-first,
 * planar layout -- NOT interleaved).
 */
export function computeISTFT(
  real: Float32Array,
  imag: Float32Array,
  numChannels: number,
  numBins: number,
  numFrames: number,
  targetLength: number,
  buffers: ISTFTBuffers,
): Float32Array {
  const paddedBins = numBins + 1;
  const paddedFrames = numFrames + 4;
  const {output, windowSum, finalOutput, ifftInput} = buffers;

  // Clear buffers
  output.fill(0);
  windowSum.fill(0);
  finalOutput.fill(0);

  const nfft = NFFT;
  const hopLength = HOP_LENGTH;
  const scale = Math.sqrt(nfft);
  const invN = 1 / nfft;

  for (let c = 0; c < numChannels; c++) {
    for (let fp = 0; fp < paddedFrames; fp++) {
      const f = fp - 2;

      // Clear complex input
      ifftInput.fill(0);

      // Fill positive frequencies (conjugated for IFFT-via-FFT trick)
      for (let b = 0; b < paddedBins; b++) {
        let realVal = 0;
        let imagVal = 0;

        if (f >= 0 && f < numFrames && b < numBins) {
          const srcIdx = c * numBins * numFrames + b * numFrames + f;
          realVal = real[srcIdx];
          imagVal = imag[srcIdx];
        }

        ifftInput[b * 2] = realVal * scale;
        ifftInput[b * 2 + 1] = -imagVal * scale; // conjugate
      }

      // Mirror negative frequencies (Hermitian symmetry, already conjugated)
      for (let b = 1; b < paddedBins - 1; b++) {
        const negIdx = nfft - b;
        ifftInput[negIdx * 2] = ifftInput[b * 2];
        ifftInput[negIdx * 2 + 1] = -ifftInput[b * 2 + 1];
      }

      // IFFT via FFT: IFFT(X) = conj(FFT(conj(X))) / N
      // We already conjugated the input above, so just FFT + conjugate output + scale
      const ifftOutput = fftInstance.fft(ifftInput);

      // Overlap-add with window (conjugate output real part = real, scale by 1/N)
      const frameStart = fp * hopLength;
      for (let i = 0; i < nfft; i++) {
        const outIdx = frameStart + i - nfft / 2;
        if (outIdx >= 0 && outIdx < ISTFT_LE) {
          // conj(FFT result) real part = real part, scaled by 1/N
          const sample = ifftOutput[i * 2] * invN * hannWindow[i];
          output[c * ISTFT_LE + outIdx] += sample;
          if (c === 0) {
            windowSum[outIdx] += hannWindow[i] * hannWindow[i];
          }
        }
      }
    }
  }

  // Normalise by the squared-window sum (COLA condition)
  for (let c = 0; c < numChannels; c++) {
    for (let i = 0; i < ISTFT_LE; i++) {
      if (windowSum[i] > 1e-8) {
        output[c * ISTFT_LE + i] /= windowSum[i];
      }
    }
  }

  // Extract the target-length region (strip the Demucs padding)
  for (let c = 0; c < numChannels; c++) {
    for (let i = 0; i < targetLength; i++) {
      finalOutput[c * targetLength + i] = output[c * ISTFT_LE + ISTFT_PAD + i];
    }
  }

  return finalOutput;
}
