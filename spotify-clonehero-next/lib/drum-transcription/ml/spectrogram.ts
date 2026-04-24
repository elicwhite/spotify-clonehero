/**
 * Log-filtered spectrogram computation for the ADTOF drum transcription model.
 *
 * Replicates madmom's LogarithmicFilteredSpectrogram preprocessing:
 *   1. STFT with frame_size=2048, hop=441 (fps=100)
 *   2. Magnitude spectrogram
 *   3. Logarithmic filterbank (12 bands/octave, fmin=20, fmax=20000 -> 84 bins)
 *   4. Log compression: log(magnitude + 1)
 *
 * Uses webfft for the STFT (same FFT library as the Demucs STFT in
 * lib/drum-transcription/audio/stft.ts, but with different parameters).
 *
 * The filterbank matrix is computed once and cached for reuse.
 *
 * The number of output bands (84 for default params) is determined by madmom's
 * `frequencies2bins(unique_bins=True)` which maps log-spaced center frequencies
 * to FFT bins and deduplicates. At low frequencies, multiple log-spaced bands
 * fall within the same FFT bin and get merged, reducing 120 nominal bands to 84.
 */

import WebFFT from 'webfft';
import type {SpectrogramConfig, MelSpectrogramConfig} from './types';
import {DEFAULT_SPECTROGRAM_CONFIG, DEFAULT_MEL_CONFIG} from './types';

// ---------------------------------------------------------------------------
// Logarithmic Filterbank
// ---------------------------------------------------------------------------

/** A4 tuning reference (440 Hz), matching madmom's default. */
const A4 = 440;

/**
 * Compute logarithmically-spaced center frequencies.
 *
 * Ports madmom's `log_frequencies(bands_per_octave, fmin, fmax, fref=A4)`.
 * Frequencies are aligned to the A4 reference (440 Hz) and spaced such that
 * there are `bandsPerOctave` bands per octave. The range is then filtered
 * to [fMin, fMax).
 *
 * @returns Array of log-spaced frequencies in Hz.
 */
export function logFrequencies(
  bandsPerOctave: number,
  fMin: number,
  fMax: number,
): number[] {
  // Compute the range relative to A4, matching madmom's floor/ceil approach
  const left = Math.floor(Math.log2(fMin / A4) * bandsPerOctave);
  const right = Math.ceil(Math.log2(fMax / A4) * bandsPerOctave);

  // Generate all frequencies in the range
  const allFreqs: number[] = [];
  for (let i = left; i < right; i++) {
    allFreqs.push(A4 * Math.pow(2, i / bandsPerOctave));
  }

  // Filter to [fMin, fMax) -- matching madmom's searchsorted filtering
  return allFreqs.filter(f => f >= fMin && f < fMax);
}

/**
 * Compute FFT bin frequencies, matching madmom's fft_frequencies.
 *
 * madmom.audio.stft.fft_frequencies(num_fft_bins, sample_rate):
 *   np.fft.fftfreq(num_fft_bins * 2, 1.0 / sample_rate)[:num_fft_bins]
 *   = k * sample_rate / (num_fft_bins * 2)  for k = 0..num_fft_bins-1
 *
 * Note: madmom uses frameSize // 2 as num_fft_bins (excluding Nyquist),
 * not frameSize // 2 + 1.
 */
export function fftFrequencies(
  numFftBins: number,
  sampleRate: number,
): Float64Array {
  const freqs = new Float64Array(numFftBins);
  for (let k = 0; k < numFftBins; k++) {
    freqs[k] = (k * sampleRate) / (numFftBins * 2);
  }
  return freqs;
}

/**
 * Map frequencies to FFT bin indices, matching madmom's frequencies2bins
 * with unique_bins=True.
 *
 * Uses searchsorted + left/right distance comparison (same as madmom)
 * to find the closest bin. When unique_bins=True, duplicates are removed
 * via Set (equivalent to np.unique).
 *
 * @returns Array of unique bin indices, sorted ascending.
 */
export function frequenciesToBins(
  targetFreqs: number[],
  fftFreqs: Float64Array,
  uniqueBins: boolean,
): number[] {
  const bins: number[] = [];
  const n = fftFreqs.length;

  for (let i = 0; i < targetFreqs.length; i++) {
    // searchsorted: find insertion point
    let idx = 0;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fftFreqs[mid] < targetFreqs[i]) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    idx = lo;

    // Clip to [1, n-1]
    idx = Math.max(1, Math.min(idx, n - 1));

    // Pick the closer side
    const leftDist = targetFreqs[i] - fftFreqs[idx - 1];
    const rightDist = fftFreqs[idx] - targetFreqs[i];
    if (leftDist < rightDist) {
      bins.push(idx - 1);
    } else {
      bins.push(idx);
    }
  }

  if (uniqueBins) {
    // np.unique: sorted unique values
    return [...new Set(bins)].sort((a, b) => a - b);
  }

  return bins;
}

/**
 * Create triangular filters from bin positions, matching madmom's
 * TriangularFilter.filters(bins, norm=True, overlap=True).
 *
 * Each triplet of consecutive bins (left, center, right) defines one
 * triangular filter. The filter is normalized so its weights sum to 1.
 *
 * With overlap=True (madmom default), the falling edge of one filter
 * overlaps with the rising edge of the next filter.
 *
 * @param bins - Array of unique bin indices (length = numFilters + 2).
 * @param numFftBins - Number of FFT bins.
 * @returns Array of normalized triangular filters.
 */
function triangularFilters(bins: number[], numFftBins: number): Float32Array[] {
  const numFilters = bins.length - 2;
  const filters: Float32Array[] = [];

  for (let i = 0; i < numFilters; i++) {
    const filter = new Float32Array(numFftBins);
    const left = bins[i];
    const center = bins[i + 1];
    const right = bins[i + 2];

    // Rising slope: left to center
    if (center > left) {
      for (let bin = left; bin <= center; bin++) {
        filter[bin] = (bin - left) / (center - left);
      }
    } else {
      // Degenerate case: left == center
      if (center < numFftBins) {
        filter[center] = 1;
      }
    }

    // Falling slope: center to right
    if (right > center) {
      for (let bin = center; bin <= right; bin++) {
        filter[bin] = (right - bin) / (right - center);
      }
    }

    // Normalize the filter (area normalization, matching madmom's norm=True)
    let filterSum = 0;
    for (let bin = 0; bin < numFftBins; bin++) {
      filterSum += filter[bin];
    }
    if (filterSum > 0) {
      for (let bin = 0; bin < numFftBins; bin++) {
        filter[bin] /= filterSum;
      }
    }

    filters.push(filter);
  }

  return filters;
}

/**
 * Create a logarithmic filterbank matrix.
 *
 * Ports madmom's LogarithmicFilterbank with triangular filters, normalization,
 * and unique_bins deduplication. The number of output bands depends on the
 * FFT resolution: at low frequencies, multiple log-spaced bands map to the
 * same FFT bin and get merged.
 *
 * For the default ADTOF config (sr=44100, frameSize=2048, 12 bands/octave,
 * fmin=20, fmax=20000), this produces 84 filters.
 *
 * Note: madmom uses frameSize // 2 as num_fft_bins for the filterbank
 * (not frameSize // 2 + 1), but the filters are applied to the full
 * STFT magnitude which has frameSize // 2 + 1 bins. We create filters
 * of length numFftBins (including Nyquist) for convenience.
 */
export function createLogFilterbank(
  sampleRate: number,
  frameSize: number,
  bandsPerOctave: number,
  fMin: number,
  fMax: number,
): {filters: Float32Array[]; numBands: number} {
  const numFftBinsForSpec = Math.floor(frameSize / 2) + 1; // 1025 (for STFT output)
  const numFftBinsForFilter = Math.floor(frameSize / 2); // 1024 (madmom convention)

  // Step 1: Compute log-spaced center frequencies
  const targetFreqs = logFrequencies(bandsPerOctave, fMin, fMax);

  // Step 2: Compute FFT bin frequencies (madmom uses frameSize // 2)
  const fftFreqs = fftFrequencies(numFftBinsForFilter, sampleRate);

  // Step 3: Map to FFT bins with deduplication (unique_bins=True)
  const bins = frequenciesToBins(targetFreqs, fftFreqs, true);

  // Step 4: Create triangular filters from the unique bin positions
  // Note: filters have length numFftBinsForSpec so they can be applied
  // directly to the STFT magnitude output
  const filters = triangularFilters(bins, numFftBinsForSpec);

  return {filters, numBands: filters.length};
}

// ---------------------------------------------------------------------------
// STFT for ADTOF (different parameters from Demucs STFT)
// ---------------------------------------------------------------------------

/**
 * Compute the magnitude spectrogram using a simple STFT.
 *
 * Unlike the Demucs STFT in audio/stft.ts (which uses NFFT=4096, hop=1024,
 * stereo, Demucs padding, and bin trimming), this STFT uses ADTOF parameters:
 *   - frameSize = 2048
 *   - hop = 441 (fps=100)
 *   - mono input
 *   - No Demucs-specific padding
 *   - Full NFFT/2+1 bins retained
 *
 * Returns the magnitude spectrogram as Float32Array of shape [nFrames, numFftBins].
 */
export function computeMagnitudeSpectrogram(
  audioData: Float32Array,
  frameSize: number,
  hopLength: number,
): {magnitudes: Float32Array; nFrames: number; numFftBins: number} {
  const numFftBins = Math.floor(frameSize / 2) + 1;
  const nFrames = Math.floor((audioData.length - frameSize) / hopLength) + 1;

  if (nFrames <= 0) {
    return {
      magnitudes: new Float32Array(0),
      nFrames: 0,
      numFftBins,
    };
  }

  const fft = new WebFFT(frameSize);

  // Pre-compute Hann window (periodic)
  const hannWindow = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / frameSize));
  }

  const magnitudes = new Float32Array(nFrames * numFftBins);
  const fftInput = new Float32Array(frameSize * 2);

  for (let frame = 0; frame < nFrames; frame++) {
    const frameStart = frame * hopLength;

    // Window the frame and pack into complex array
    for (let i = 0; i < frameSize; i++) {
      const sampleIdx = frameStart + i;
      fftInput[i * 2] =
        sampleIdx < audioData.length ? audioData[sampleIdx] * hannWindow[i] : 0;
      fftInput[i * 2 + 1] = 0;
    }

    const fftOutput = fft.fft(fftInput);

    // Compute magnitude for positive frequencies only
    const offset = frame * numFftBins;
    for (let k = 0; k < numFftBins; k++) {
      const re = fftOutput[k * 2];
      const im = fftOutput[k * 2 + 1];
      magnitudes[offset + k] = Math.sqrt(re * re + im * im);
    }
  }

  return {magnitudes, nFrames, numFftBins};
}

// ---------------------------------------------------------------------------
// Full Pipeline
// ---------------------------------------------------------------------------

/** Cached filterbank to avoid recomputation. */
let cachedFilterbank: {
  config: SpectrogramConfig;
  filters: Float32Array[];
  numBands: number;
} | null = null;

/**
 * Get or create the cached filterbank for the given config.
 */
export function getFilterbank(config: SpectrogramConfig): {
  filters: Float32Array[];
  numBands: number;
} {
  if (
    cachedFilterbank &&
    cachedFilterbank.config.sampleRate === config.sampleRate &&
    cachedFilterbank.config.frameSize === config.frameSize &&
    cachedFilterbank.config.bandsPerOctave === config.bandsPerOctave &&
    cachedFilterbank.config.fMin === config.fMin &&
    cachedFilterbank.config.fMax === config.fMax
  ) {
    return {
      filters: cachedFilterbank.filters,
      numBands: cachedFilterbank.numBands,
    };
  }

  const {filters, numBands} = createLogFilterbank(
    config.sampleRate,
    config.frameSize,
    config.bandsPerOctave,
    config.fMin,
    config.fMax,
  );

  cachedFilterbank = {config: {...config}, filters, numBands};
  return {filters, numBands};
}

/**
 * Compute the log-filtered spectrogram for the ADTOF model.
 *
 * Pipeline:
 *   1. STFT (frame_size=2048, hop=441)
 *   2. Magnitude spectrogram
 *   3. Apply logarithmic filterbank (84 bands for default config)
 *   4. Log compression: log(magnitude + 1)
 *
 * @param audioData - Mono audio signal at the configured sample rate.
 * @param config - Spectrogram configuration (defaults to ADTOF params).
 * @returns Float32Array of shape [nFrames, numBands] (row-major), plus nFrames.
 */
export function computeLogFilteredSpectrogram(
  audioData: Float32Array,
  config: SpectrogramConfig = DEFAULT_SPECTROGRAM_CONFIG,
): {spectrogram: Float32Array; nFrames: number; numBands: number} {
  const hopLength = Math.round(config.sampleRate / config.fps);

  // Step 1-2: STFT + magnitude
  const {magnitudes, nFrames, numFftBins} = computeMagnitudeSpectrogram(
    audioData,
    config.frameSize,
    hopLength,
  );

  if (nFrames === 0) {
    return {spectrogram: new Float32Array(0), nFrames: 0, numBands: 0};
  }

  // Step 3: Apply logarithmic filterbank
  const {filters, numBands} = getFilterbank(config);

  const spectrogram = new Float32Array(nFrames * numBands);

  for (let frame = 0; frame < nFrames; frame++) {
    const magOffset = frame * numFftBins;
    const specOffset = frame * numBands;

    for (let band = 0; band < numBands; band++) {
      let sum = 0;
      const filter = filters[band];
      for (let bin = 0; bin < numFftBins; bin++) {
        sum += magnitudes[magOffset + bin] * filter[bin];
      }
      // Step 4: Log compression
      spectrogram[specOffset + band] = Math.log(sum + 1);
    }
  }

  return {spectrogram, nFrames, numBands};
}

// ---------------------------------------------------------------------------
// Mel Filterbank (for CRNN model)
// ---------------------------------------------------------------------------

/** Convert frequency in Hz to mel scale (HTK formula). */
export function hzToMel(hz: number): number {
  return 2595.0 * Math.log10(1.0 + hz / 700.0);
}

/** Convert mel scale to frequency in Hz (HTK formula). */
export function melToHz(mel: number): number {
  return 700.0 * (Math.pow(10.0, mel / 2595.0) - 1.0);
}

/**
 * Create a mel filterbank matrix.
 *
 * Produces nMels triangular filters on the mel scale, matching the
 * training code in pipeline/build_training_data.py.
 *
 * @returns Array of nMels filters, each of length nFft/2+1.
 */
export function createMelFilterbank(
  nFft: number,
  sampleRate: number,
  nMels: number,
  fMin: number,
  fMax: number,
): Float32Array[] {
  const nFreqs = Math.floor(nFft / 2) + 1;

  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);

  // nMels + 2 evenly spaced mel points (includes left/right edges)
  const melPoints = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melMin + (i * (melMax - melMin)) / (nMels + 1);
  }

  // Convert mel points to Hz
  const hzPoints = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    hzPoints[i] = melToHz(melPoints[i]);
  }

  // FFT bin frequencies: k * sampleRate / nFft for k = 0..nFreqs-1
  // Equivalent to np.linspace(0, sampleRate/2, nFreqs)
  const freqBins = new Float64Array(nFreqs);
  for (let k = 0; k < nFreqs; k++) {
    freqBins[k] = (k * sampleRate) / nFft;
  }

  // Build triangular filters
  const filters: Float32Array[] = [];
  for (let i = 0; i < nMels; i++) {
    const filter = new Float32Array(nFreqs);
    const lo = hzPoints[i];
    const center = hzPoints[i + 1];
    const hi = hzPoints[i + 2];

    for (let j = 0; j < nFreqs; j++) {
      const f = freqBins[j];
      if (f >= lo && f <= center) {
        filter[j] = (f - lo) / (center - lo + 1e-10);
      } else if (f > center && f <= hi) {
        filter[j] = (hi - f) / (hi - center + 1e-10);
      }
    }

    filters.push(filter);
  }

  return filters;
}

/** Cached mel filterbank. */
let cachedMelFilterbank: {
  config: MelSpectrogramConfig;
  filters: Float32Array[];
} | null = null;

/**
 * Get or create the cached mel filterbank for the given config.
 */
export function getMelFilterbank(config: MelSpectrogramConfig): Float32Array[] {
  if (
    cachedMelFilterbank &&
    cachedMelFilterbank.config.nFft === config.nFft &&
    cachedMelFilterbank.config.sampleRate === config.sampleRate &&
    cachedMelFilterbank.config.nMels === config.nMels &&
    cachedMelFilterbank.config.fMin === config.fMin &&
    cachedMelFilterbank.config.fMax === config.fMax
  ) {
    return cachedMelFilterbank.filters;
  }

  const filters = createMelFilterbank(
    config.nFft,
    config.sampleRate,
    config.nMels,
    config.fMin,
    config.fMax,
  );

  cachedMelFilterbank = {config: {...config}, filters};
  return filters;
}

/**
 * Compute the mel spectrogram for the CRNN model.
 *
 * Pipeline:
 *   1. STFT (nFft=2048, hop=441)
 *   2. Power spectrogram (|STFT|²)
 *   3. Apply mel filterbank (128 bands)
 *   4. Log compression: log(power + 1e-6)
 *
 * @param audioData - Mono audio signal at the configured sample rate.
 * @param config - Mel spectrogram configuration.
 * @returns Float32Array of shape [nFrames, nMels] (row-major), plus nFrames and nMels.
 */
export function computeMelSpectrogram(
  audioData: Float32Array,
  config: MelSpectrogramConfig = DEFAULT_MEL_CONFIG,
): {spectrogram: Float32Array; nFrames: number; nMels: number} {
  // Step 1-2: STFT + magnitude
  const {magnitudes, nFrames, numFftBins} = computeMagnitudeSpectrogram(
    audioData,
    config.nFft,
    config.hopLength,
  );

  if (nFrames === 0) {
    return {spectrogram: new Float32Array(0), nFrames: 0, nMels: config.nMels};
  }

  // Step 3: Apply mel filterbank to power spectrum
  const filters = getMelFilterbank(config);
  const nMels = filters.length;
  const spectrogram = new Float32Array(nFrames * nMels);

  for (let frame = 0; frame < nFrames; frame++) {
    const magOffset = frame * numFftBins;
    const specOffset = frame * nMels;

    for (let band = 0; band < nMels; band++) {
      let sum = 0;
      const filter = filters[band];
      for (let bin = 0; bin < numFftBins; bin++) {
        // Power = magnitude² (magnitudes from computeMagnitudeSpectrogram are |STFT|)
        const mag = magnitudes[magOffset + bin];
        sum += mag * mag * filter[bin];
      }
      // Step 4: Log compression matching training code: log(power + 1e-6)
      spectrogram[specOffset + band] = Math.log(sum + 1e-6);
    }
  }

  return {spectrogram, nFrames, nMels};
}
