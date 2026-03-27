/**
 * Panning feature computation for the CRNN drum transcription model.
 *
 * Computes L/R energy ratio in 4 frequency bands from stereo audio,
 * matching the training code in pipeline/build_training_data.py.
 *
 * For each band: (R_power - L_power) / (R_power + L_power + eps)
 * Range: approximately -1 (hard left) to +1 (hard right).
 *
 * Frequency bands:
 *   Band 0: 0–300 Hz
 *   Band 1: 300–3000 Hz
 *   Band 2: 3000–8000 Hz
 *   Band 3: 8000–20000 Hz
 */

import WebFFT from 'webfft';
import type {MelSpectrogramConfig} from './types';
import {DEFAULT_MEL_CONFIG, PANNING_BANDS_HZ} from './types';

/**
 * Compute panning features from stereo interleaved audio.
 *
 * @param stereoAudio - Interleaved stereo audio [L0, R0, L1, R1, ...] at sampleRate.
 * @param config - Spectrogram config (for nFft, hopLength, sampleRate).
 * @returns Float32Array of shape [4, nFrames] (band-major, matching training code layout).
 */
export function computePanningFeatures(
  stereoAudio: Float32Array,
  config: MelSpectrogramConfig = DEFAULT_MEL_CONFIG,
): {panning: Float32Array; nFrames: number} {
  const numSamples = stereoAudio.length / 2;
  const {nFft, hopLength, sampleRate} = config;
  const numFftBins = Math.floor(nFft / 2) + 1;
  const nFrames = Math.floor((numSamples - nFft) / hopLength) + 1;

  if (nFrames <= 0) {
    return {panning: new Float32Array(0), nFrames: 0};
  }

  const fft = new WebFFT(nFft);

  // Pre-compute Hann window
  const hannWindow = new Float32Array(nFft);
  for (let i = 0; i < nFft; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / nFft));
  }

  // Pre-compute frequency bin → band mapping
  const binBand = new Int8Array(numFftBins);
  binBand.fill(-1);
  for (let k = 0; k < numFftBins; k++) {
    const binHz = (k * sampleRate) / nFft;
    for (let b = 0; b < PANNING_BANDS_HZ.length; b++) {
      if (binHz >= PANNING_BANDS_HZ[b][0] && binHz < PANNING_BANDS_HZ[b][1]) {
        binBand[k] = b;
        break;
      }
    }
  }

  // Output: [4, nFrames] band-major
  const panning = new Float32Array(4 * nFrames);

  const fftInputL = new Float32Array(nFft * 2);
  const fftInputR = new Float32Array(nFft * 2);

  for (let frame = 0; frame < nFrames; frame++) {
    const frameStart = frame * hopLength;

    // Window and pack left/right channels into complex arrays
    for (let i = 0; i < nFft; i++) {
      const sampleIdx = frameStart + i;
      const lSample =
        sampleIdx < numSamples
          ? stereoAudio[sampleIdx * 2] * hannWindow[i]
          : 0;
      const rSample =
        sampleIdx < numSamples
          ? stereoAudio[sampleIdx * 2 + 1] * hannWindow[i]
          : 0;

      fftInputL[i * 2] = lSample;
      fftInputL[i * 2 + 1] = 0;
      fftInputR[i * 2] = rSample;
      fftInputR[i * 2 + 1] = 0;
    }

    const fftOutputL = fft.fft(fftInputL);
    const fftOutputR = fft.fft(fftInputR);

    // Accumulate power per band
    const lBandPower = [0, 0, 0, 0];
    const rBandPower = [0, 0, 0, 0];

    for (let k = 0; k < numFftBins; k++) {
      const band = binBand[k];
      if (band < 0) continue;

      const reL = fftOutputL[k * 2];
      const imL = fftOutputL[k * 2 + 1];
      lBandPower[band] += reL * reL + imL * imL;

      const reR = fftOutputR[k * 2];
      const imR = fftOutputR[k * 2 + 1];
      rBandPower[band] += reR * reR + imR * imR;
    }

    // Compute panning ratio per band: (R - L) / (R + L + eps)
    for (let b = 0; b < 4; b++) {
      const denom = lBandPower[b] + rBandPower[b] + 1e-10;
      panning[b * nFrames + frame] =
        (rBandPower[b] - lBandPower[b]) / denom;
    }
  }

  return {panning, nFrames};
}
