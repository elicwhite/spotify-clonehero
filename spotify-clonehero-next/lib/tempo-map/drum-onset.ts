/**
 * Drum-onset offset DSP.
 *
 * Port of `_build_drum_onset_offset_cache.py:{spectral_flux_envelope,
 * find_nearest_peak}` from the heuristic autoresearch tree.
 *
 * Computes the median offset (ms) between Beat This! PP beats and the
 * nearest spectral-flux peak on the drum stem. Negative = onset earlier than
 * beat. Consumed by the converter's CONTINUOUS_LAG mechanism.
 */

import {fftRadix2InPlace} from './fft-radix2';

/** Symmetric Hann window (matches scipy.get_window('hann', n)). */
function symmetricHann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

/**
 * Spectral-flux envelope of mono Float32 PCM at sample rate `sr`. Mirrors
 * scipy.signal.stft(window='hann', boundary=None, padded=False) followed by
 * np.diff(prepend=first column) → clip(0,∞) → sum across bins.
 */
export function spectralFluxEnvelope(
  audio: Float32Array,
  sr: number,
  hopMs = 5.0,
): {flux: Float32Array; fps: number} {
  const hop = Math.round((sr * hopMs) / 1000.0);
  const nperseg = Math.max(hop * 4, 1024);
  // scipy.stft boundary=None, padded=False: T = floor((N - nperseg + hop) / hop)
  const N = audio.length;
  const T = Math.max(0, Math.floor((N - nperseg + hop) / hop));
  if (T <= 0) return {flux: new Float32Array(0), fps: sr / hop};

  // hop = round(sr*5/1000) so hop*4 = sr/50 < 1024 for all sr ≤ 51200 —
  // nperseg is always exactly 1024 in practice, a power of 2 as the radix-2
  // FFT requires.
  const nfft = nperseg;
  if ((nfft & (nfft - 1)) !== 0) {
    throw new Error(`spectralFluxEnvelope: nfft=${nfft} not power of 2`);
  }

  const window = symmetricHann(nperseg);
  const nBins = nfft / 2 + 1;
  const magPrev = new Float32Array(nBins);
  const fftBuf = new Float32Array(nfft * 2);
  const flux = new Float32Array(T);

  for (let t = 0; t < T; t++) {
    const start = t * hop;
    fftBuf.fill(0);
    for (let i = 0; i < nperseg; i++) {
      fftBuf[2 * i] = audio[start + i] * window[i];
    }
    fftRadix2InPlace(fftBuf, nfft);
    // sum_{bin} max(0, |X_t[bin]| - |X_{t-1}[bin]|)
    let sum = 0;
    for (let b = 0; b < nBins; b++) {
      const re = fftBuf[2 * b];
      const im = fftBuf[2 * b + 1];
      const mag = Math.sqrt(re * re + im * im);
      const d = mag - magPrev[b];
      if (d > 0) sum += d;
      magPrev[b] = mag;
    }
    flux[t] = sum;
  }
  return {flux, fps: sr / hop};
}

/**
 * Find the time (ms) of the highest peak in `env` within ±windowMs of t_ms.
 * Returns null if there's no usable window.
 */
export function findNearestPeak(
  t_ms: number,
  env: Float32Array,
  envFps: number,
  windowMs = 50.0,
): number | null {
  const hopMs = 1000.0 / envFps;
  const center = Math.round(t_ms / hopMs);
  const half = Math.round(windowMs / hopMs);
  const lo = Math.max(0, center - half);
  const hi = Math.min(env.length, center + half + 1);
  if (hi <= lo + 2) return null;
  let bestIdx = lo,
    bestVal = -Infinity;
  for (let i = lo; i < hi; i++) {
    if (env[i] > bestVal) {
      bestVal = env[i];
      bestIdx = i;
    }
  }
  return bestIdx * hopMs;
}

/**
 * Median of (peak_ms - beat_ms) across all full-mix PP beats, with the
 * spectral flux computed on the drum stem. Returns null if fewer than 8
 * valid pairings (matches the Python cache builder's threshold).
 */
export function computeDrumOnsetOffsetMs({
  drumStemPcm,
  sr,
  ppFmBeatsSec,
}: {
  drumStemPcm: Float32Array;
  sr: number;
  ppFmBeatsSec: number[];
}): number | null {
  const beatsMs = ppFmBeatsSec.map(s => s * 1000);
  if (beatsMs.length < 4) return null;
  const {flux, fps} = spectralFluxEnvelope(drumStemPcm, sr, 5.0);
  if (flux.length === 0) return null;
  const offsets: number[] = [];
  for (const tb of beatsMs) {
    const p = findNearestPeak(tb, flux, fps, 50.0);
    if (p !== null) offsets.push(p - tb);
  }
  if (offsets.length < 8) return null;
  offsets.sort((a, b) => a - b);
  const mid = offsets.length >> 1;
  return offsets.length % 2 === 0
    ? (offsets[mid - 1] + offsets[mid]) / 2 // numpy median
    : offsets[mid];
}
