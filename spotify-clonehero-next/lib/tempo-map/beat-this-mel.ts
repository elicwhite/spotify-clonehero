/**
 * Beat This! log-mel spectrogram, port of beat_this.preprocessing.LogMelSpect.
 *
 * Config (load-bearing, baked into beat-this-mel-fb.json):
 *   sample_rate=22050, n_fft=1024, hop=441, win=1024
 *   f_min=30, f_max=11000, n_mels=128, mel_scale='slaney',
 *   normalized='frame_length' (divide STFT magnitude by sqrt(win_length)),
 *   power=1 (magnitude), log = log1p(1000*mel)
 *
 * Output: Float32Array of length (T * 128), row-major (T x 128), matching
 * what the Beat This! ONNX consumes.
 */

import {fftRadix2InPlace} from './fft-radix2';
import filterbankJson from './beat-this-mel-fb.json';
import {resampleSoxr} from './resampler-soxr';

export const BEAT_THIS_SAMPLE_RATE = 22050;

interface Filterbank {
  flat: Float32Array;
  nMels: number;
  nBins: number;
  nFft: number;
  hopLength: number;
  winLength: number;
  logMultiplier: number;
  stftDivisor: number;
}

let _fb: Filterbank | null = null;

function getFilterbank(): Filterbank {
  if (_fb) return _fb;
  const payload = filterbankJson as {
    n_mels: number;
    n_stft_bins: number;
    n_fft: number;
    hop_length: number;
    win_length: number;
    log_multiplier: number;
    stft_normalization_divisor: number;
    filterbank: number[][];
  };
  // Flatten (128, 513) for cache-friendly inner loops.
  const nMels = payload.n_mels;
  const nBins = payload.n_stft_bins;
  const flat = new Float32Array(nMels * nBins);
  for (let m = 0; m < nMels; m++) {
    const row = payload.filterbank[m];
    for (let b = 0; b < nBins; b++) flat[m * nBins + b] = row[b];
  }
  _fb = {
    flat,
    nMels,
    nBins,
    nFft: payload.n_fft,
    hopLength: payload.hop_length,
    winLength: payload.win_length,
    logMultiplier: payload.log_multiplier,
    stftDivisor: payload.stft_normalization_divisor,
  };
  return _fb;
}

let _hann: Float32Array | null = null;
function getHann(N: number): Float32Array {
  if (_hann && _hann.length === N) return _hann;
  // torchaudio.MelSpectrogram → torch.stft default window is
  // hann_window(N, periodic=True): 0.5*(1 - cos(2π i/N)).
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N));
  _hann = w;
  return w;
}

/**
 * Reflect-pad signal by `pad` samples on each side (matches torch.stft
 * center=True with pad_mode='reflect'). The reflection skips the boundary
 * sample: for [a,b,c,d], reflect_left(2) gives [c,b,a,b,c,d].
 */
function reflectPad(signal: Float32Array, pad: number): Float32Array {
  const N = signal.length;
  const out = new Float32Array(N + 2 * pad);
  for (let i = 0; i < pad; i++) out[i] = signal[pad - i];
  for (let i = 0; i < N; i++) out[pad + i] = signal[i];
  for (let i = 0; i < pad; i++) out[pad + N + i] = signal[N - 2 - i];
  return out;
}

/**
 * Compute the log-mel spectrogram of mono Float32 PCM @ 22050 Hz exactly as
 * beat_this.preprocessing.LogMelSpect does.
 */
export function computeLogMel(signal: Float32Array): {
  mel: Float32Array;
  T: number;
  nMels: number;
} {
  const fb = getFilterbank();
  const {flat: fbFlat, nMels, nBins, nFft, hopLength, winLength, logMultiplier, stftDivisor} = fb;

  // center=True: pad both sides by n_fft/2. T = 1 + floor(len / hop).
  const pad = Math.floor(nFft / 2);
  const padded = reflectPad(signal, pad);
  const T = Math.floor(signal.length / hopLength) + 1;

  const window = getHann(winLength);

  const fftBuf = new Float32Array(nFft * 2);
  const magBuf = new Float32Array(nBins);
  const mel = new Float32Array(T * nMels);

  for (let t = 0; t < T; t++) {
    const start = t * hopLength;
    fftBuf.fill(0);
    for (let i = 0; i < winLength; i++) {
      fftBuf[2 * i] = padded[start + i] * window[i];
    }
    fftRadix2InPlace(fftBuf, nFft);
    // magnitude / sqrt(win_length) — `normalized='frame_length'`
    for (let b = 0; b < nBins; b++) {
      const re = fftBuf[2 * b];
      const im = fftBuf[2 * b + 1];
      magBuf[b] = Math.sqrt(re * re + im * im) / stftDivisor;
    }
    // mel matmul: (128, 513) @ (513,) -> (128,) then log1p(1000 * mel)
    for (let m = 0; m < nMels; m++) {
      let acc = 0;
      const fbRow = m * nBins;
      for (let b = 0; b < nBins; b++) {
        acc += fbFlat[fbRow + b] * magBuf[b];
      }
      mel[t * nMels + m] = Math.log1p(logMultiplier * acc);
    }
  }

  return {mel, T, nMels};
}

/**
 * Resample mono Float32 PCM to 22050 Hz via WASM libsoxr (matches Python
 * soxr to ~3e-8 mean abs err).
 */
export async function resampleToBeatThis(
  monoPcm: Float32Array,
  fromSr: number,
): Promise<Float32Array> {
  if (fromSr === BEAT_THIS_SAMPLE_RATE) return monoPcm;
  return resampleSoxr(monoPcm, fromSr, BEAT_THIS_SAMPLE_RATE);
}
