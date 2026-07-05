// LinkSeg mel front-end (stays in JS; STFT never enters the ONNX graph).
// Reproduces torchaudio MelSpectrogram(sr=22050, n_fft=1024, hop=256, n_mels=64, f_min=0,
// f_max=11025, power=2, center=True, reflect pad, periodic Hann, htk mel, norm=None) followed by
// AmplitudeToDB(stype='power', top_db=None) = 10*log10(max(x, 1e-10)).
//
// The exact torchaudio mel filterbank (64 x 513) is shipped as linkseg-mel-fb.json to avoid any
// htk-mel reconstruction drift. Per beat, LinkSeg feeds a 16382-sample window (see build-windows)
// which this turns into a (64 mel x 64 time) dB image; the ONNX input is (N,1,64,64) with layout
// [n*4096 + mel*64 + time].

import {fftRadix2InPlace} from './fft-radix2';
import fbJson from './linkseg-mel-fb.json';

export const LINKSEG_SR = 22050;
export const LINKSEG_N_FFT = 1024;
export const LINKSEG_HOP = 256;
export const LINKSEG_N_MELS = 64;
export const LINKSEG_WIN_SAMPLES = 16382; // per-beat window length (see build-windows.ts)
export const LINKSEG_MEL_FRAMES = 64; // frames per window with center pad
const AMIN = 1e-10;
const CENTER_PAD = LINKSEG_N_FFT / 2; // 512

const FB: number[][] = (fbJson as {fb: number[][]}).fb; // (64, 513)

let hannCache: Float64Array | null = null;
function getHann(): Float64Array {
  if (hannCache) return hannCache;
  const w = new Float64Array(LINKSEG_N_FFT);
  // periodic Hann: 0.5 * (1 - cos(2*pi*n/N)), N = n_fft
  for (let n = 0; n < LINKSEG_N_FFT; n++) {
    w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / LINKSEG_N_FFT));
  }
  hannCache = w;
  return w;
}

// numpy/torch 'reflect' pad (no edge-sample repeat) of `pad` samples on each side.
function reflectPad(x: Float32Array, pad: number): Float32Array {
  const L = x.length;
  const out = new Float32Array(L + 2 * pad);
  for (let k = 0; k < pad; k++) out[k] = x[pad - k]; // left: x[pad..1]
  out.set(x, pad);
  for (let k = 0; k < pad; k++) out[pad + L + k] = x[L - 2 - k]; // right: x[L-2..]
  return out;
}

/**
 * One beat window (LINKSEG_WIN_SAMPLES samples) -> (64 mel x 64 time) dB, laid out [mel*64 + time].
 * Writes into `dst` at `dstOffset` (length 4096).
 */
export function melWindowInto(window: Float32Array, dst: Float32Array, dstOffset: number): void {
  const hann = getHann();
  const padded = reflectPad(window, CENTER_PAD);
  const nBins = LINKSEG_N_FFT / 2 + 1; // 513
  const buf = new Float32Array(2 * LINKSEG_N_FFT);
  const power = new Float32Array(nBins);

  for (let t = 0; t < LINKSEG_MEL_FRAMES; t++) {
    const start = t * LINKSEG_HOP;
    // windowed frame -> interleaved complex buffer (imag = 0)
    for (let n = 0; n < LINKSEG_N_FFT; n++) {
      buf[n << 1] = padded[start + n] * hann[n];
      buf[(n << 1) + 1] = 0;
    }
    fftRadix2InPlace(buf, LINKSEG_N_FFT);
    for (let b = 0; b < nBins; b++) {
      const re = buf[b << 1];
      const im = buf[(b << 1) + 1];
      power[b] = re * re + im * im; // power=2
    }
    // mel projection + dB, written column-wise into [mel*64 + t]
    for (let m = 0; m < LINKSEG_N_MELS; m++) {
      const fbRow = FB[m];
      let acc = 0;
      for (let b = 0; b < nBins; b++) acc += fbRow[b] * power[b];
      const db = 10 * Math.log10(Math.max(acc, AMIN));
      dst[dstOffset + m * LINKSEG_MEL_FRAMES + t] = db;
    }
  }
}

/** Stack per-beat mel windows into the ONNX input tensor data (N x 1 x 64 x 64). */
export function melForWindows(windows: Float32Array[]): Float32Array {
  const N = windows.length;
  const out = new Float32Array(N * LINKSEG_N_MELS * LINKSEG_MEL_FRAMES);
  for (let i = 0; i < N; i++) melWindowInto(windows[i], out, i * LINKSEG_N_MELS * LINKSEG_MEL_FRAMES);
  return out;
}
