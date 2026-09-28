/**
 * Small, dependency-free DSP toolkit for the soundtrack tools: FFT, spectral
 * flux onsets (with synthetic test bursts to measure the detector's own
 * latency, which `detectOnsets` removes), biquad and Butterworth filters,
 * ITU-R BS.1770-4 loudness and true peak. Everything is deterministic (noise
 * comes from the kit's seeded mulberry32) and works at SAMPLE_RATE.
 */
import {mulberry32} from '../../src/motion/random';
import {SAMPLE_RATE, type Stereo} from './pcm';

// ---------------------------------------------------------------- FFT

const twiddleCache = new Map<number, {cos: Float64Array; sin: Float64Array}>();

function twiddles(n: number): {cos: Float64Array; sin: Float64Array} {
  let t = twiddleCache.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n);
      sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    t = {cos, sin};
    twiddleCache.set(n, t);
  }
  return t;
}

/** In-place radix-2 complex FFT (forward). n must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  const {cos, sin} = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const wr = cos[j * step]!;
        const wi = sin[j * step]!;
        const a = i + j;
        const b = a + half;
        const vr = re[b]! * wr - im[b]! * wi;
        const vi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - vr;
        im[b] = im[a]! - vi;
        re[a] = re[a]! + vr;
        im[a] = im[a]! + vi;
      }
    }
  }
}

/** In-place inverse FFT (scaled by 1/n). */
function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i]!;
  fft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] = re[i]! / n;
    im[i] = -im[i]! / n;
  }
}

/** Linear convolution of x with h via FFT. Output length x.length + h.length - 1. */
export function fftConvolve(x: Float32Array, h: Float32Array): Float32Array {
  const outLen = x.length + h.length - 1;
  let n = 1;
  while (n < outLen) n <<= 1;
  const xr = new Float64Array(n);
  const xi = new Float64Array(n);
  const hr = new Float64Array(n);
  const hi = new Float64Array(n);
  xr.set(x);
  hr.set(h);
  fft(xr, xi);
  fft(hr, hi);
  for (let k = 0; k < n; k++) {
    const r = xr[k]! * hr[k]! - xi[k]! * hi[k]!;
    const i = xr[k]! * hi[k]! + xi[k]! * hr[k]!;
    xr[k] = r;
    xi[k] = i;
  }
  ifft(xr, xi);
  return Float32Array.from(xr.subarray(0, outLen));
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++)
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export function toMono(s: Stereo): Float32Array {
  const m = new Float32Array(s.l.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (s.l[i]! + s.r[i]!);
  return m;
}

// ---------------------------------------------------------------- Onsets

export interface OnsetOptions {
  frameSize?: number;
  hop?: number;
  /** Only bins inside [fMin, fMax] Hz contribute to the flux. */
  fMin?: number;
  fMax?: number;
  /** Seconds either side for the local-maximum test. */
  peakWindow?: number;
  /** Seconds either side for the adaptive (median) threshold. */
  medianWindow?: number;
  /** Threshold above the local median, as a fraction of the global max flux. */
  delta?: number;
}

interface FluxCurve {
  /** Time of each flux value: the centre of the analysis frame, seconds. */
  times: Float64Array;
  flux: Float64Array;
}

/**
 * Log-magnitude spectral flux (half-wave rectified), one value per hop.
 * The time reference is the frame centre.
 */
function spectralFlux(
  mono: Float32Array,
  {
    frameSize = 1024,
    hop = 64,
    fMin = 0,
    fMax = SAMPLE_RATE / 2,
  }: OnsetOptions = {},
): FluxCurve {
  const win = hann(frameSize);
  const bins = frameSize / 2 + 1;
  const kMin = Math.max(0, Math.ceil((fMin * frameSize) / SAMPLE_RATE));
  const kMax = Math.min(bins - 1, Math.floor((fMax * frameSize) / SAMPLE_RATE));
  const frames = Math.max(0, Math.floor((mono.length - frameSize) / hop) + 1);
  const times = new Float64Array(frames);
  const flux = new Float64Array(frames);
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < frameSize; i++) {
      re[i] = mono[start + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let k = kMin; k <= kMax; k++) {
      const mag = Math.hypot(re[k]!, im[k]!);
      cur[k] = Math.log1p(1000 * mag);
      if (f > 0) sum += Math.max(0, cur[k]! - prev[k]!);
    }
    times[f] = (start + frameSize / 2) / SAMPLE_RATE;
    flux[f] = sum;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return {times, flux};
}

/**
 * An onset: its time (seconds), its flux relative to the loudest in the
 * analysed stretch (`strength`, 0..1) and its raw flux (summed log-magnitude
 * rise, which does not depend on the level).
 */
export interface Onset {
  t: number;
  strength: number;
  flux: number;
}

/** Peak-picks a flux curve into onsets. */
function pickOnsets(
  {times, flux}: FluxCurve,
  {
    peakWindow = 0.03,
    medianWindow = 0.1,
    delta = 0.06,
    hop = 64,
  }: OnsetOptions = {},
): Onset[] {
  const n = flux.length;
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, flux[i]!);
  const hopSec = hop / SAMPLE_RATE;
  const pw = Math.max(1, Math.round(peakWindow / hopSec));
  const mw = Math.max(1, Math.round(medianWindow / hopSec));
  const out: Onset[] = [];
  const scratch: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = flux[i]!;
    let isMax = true;
    for (let j = Math.max(0, i - pw); j <= Math.min(n - 1, i + pw); j++) {
      if (flux[j]! > v || (flux[j]! === v && j < i)) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    scratch.length = 0;
    for (let j = Math.max(0, i - mw); j <= Math.min(n - 1, i + mw); j++) {
      scratch.push(flux[j]!);
    }
    scratch.sort((a, b) => a - b);
    const median = scratch[scratch.length >> 1]!;
    if (v < median + delta * max) continue;
    // Parabolic interpolation of the peak position.
    const a = flux[i - 1]!;
    const c = flux[i + 1]!;
    const denom = a - 2 * v + c;
    const frac = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const t = times[i]! + Math.max(-0.5, Math.min(0.5, frac)) * hopSec;
    out.push({t, strength: v / max, flux: v});
  }
  return out;
}

export function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : 0.5 * (s[m - 1]! + s[m]!);
}

let bursts: {signal: Float32Array; truth: number[]} | null = null;

/**
 * Twenty seconds of synthetic drum-like hits (decaying noise bursts) and
 * their start times, for measuring an onset detector's own latency. Built
 * once; deterministic.
 */
export function syntheticBursts(): {signal: Float32Array; truth: number[]} {
  if (bursts) return bursts;
  const dur = 20;
  const signal = new Float32Array(dur * SAMPLE_RATE);
  const rnd = mulberry32(12345);
  const truth: number[] = [];
  for (let t = 0.5; t < dur - 0.5; t += 0.2 + 0.1 * rnd()) {
    truth.push(t);
    const amp = 0.2 + 0.6 * rnd();
    const decay = 0.02 + 0.08 * rnd();
    const start = Math.round(t * SAMPLE_RATE);
    for (let i = 0; i < 0.4 * SAMPLE_RATE && start + i < signal.length; i++) {
      signal[start + i] =
        signal[start + i]! +
        amp * Math.exp(-i / SAMPLE_RATE / decay) * (rnd() * 2 - 1);
    }
  }
  bursts = {signal, truth};
  return bursts;
}

const biasCache = new Map<string, number>();

/** The spectral-flux detector's own latency for these options (seconds). */
function onsetBias(opts: OnsetOptions = {}): number {
  const key = JSON.stringify(opts);
  const cached = biasCache.get(key);
  if (cached !== undefined) return cached;
  const {signal, truth} = syntheticBursts();
  const found = pickOnsets(spectralFlux(signal, opts), opts).map(o => o.t);
  const offsets: number[] = [];
  for (const t of truth) {
    let best: number | null = null;
    for (const f of found) {
      if (
        Math.abs(f - t) < 0.03 &&
        (best === null || Math.abs(f - t) < Math.abs(best))
      )
        best = f - t;
    }
    if (best !== null) offsets.push(best);
  }
  const bias = median(offsets);
  biasCache.set(key, bias);
  return bias;
}

/** Onsets with the detector's latency removed: times are attack times. */
export function detectOnsets(
  mono: Float32Array,
  opts: OnsetOptions = {},
): Onset[] {
  const bias = onsetBias(opts);
  return pickOnsets(spectralFlux(mono, opts), opts).map(o => ({
    ...o,
    t: o.t - bias,
  }));
}

// ---------------------------------------------------------------- Filters

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Second-order Butterworth low- or high-pass section (RBJ cookbook). */
export function butterworth(kind: 'lp' | 'hp', fc: number): Biquad {
  const w = (2 * Math.PI * fc) / SAMPLE_RATE;
  const alpha = Math.sin(w) / Math.SQRT2;
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = kind === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b1 = kind === 'lp' ? 1 - cos : -(1 + cos);
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b0 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Runs `x` through one biquad section (direct form I, float64 state). */
export function biquad(
  x: Float32Array | Float64Array,
  f: Biquad,
): Float64Array {
  return biquadSteps(x, [{from: 0, f}]);
}

/**
 * Runs `x` through a biquad section whose coefficients change at sample
 * `from` of each step (ascending, the first at 0). The filter state carries
 * across the changes, so a stepped sweep has no restart transient.
 */
export function biquadSteps(
  x: Float32Array | Float64Array,
  steps: readonly {from: number; f: Biquad}[],
): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  steps.forEach(({f}, k) => {
    const end = Math.min(x.length, steps[k + 1]?.from ?? x.length);
    for (let i = Math.max(0, steps[k]!.from); i < end; i++) {
      const xi = x[i]!;
      const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
      y[i] = yi;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = yi;
    }
  });
  return y;
}

// ---------------------------------------------------------------- Loudness

// BS.1770-4 K-weighting at 48 kHz: high shelf + RLB high-pass.
export const K_SHELF: Biquad = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a1: -1.69065929318241,
  a2: 0.73248077421585,
};
export const K_HIGHPASS: Biquad = {
  b0: 1.0,
  b1: -2.0,
  b2: 1.0,
  a1: -1.99004745483398,
  a2: 0.99007225036621,
};

function kWeightedSquares(s: Stereo): Float64Array[] {
  return [s.l, s.r].map(ch => {
    const a = biquad(ch, K_SHELF);
    const b = biquad(Float32Array.from(a), K_HIGHPASS);
    for (let i = 0; i < b.length; i++) b[i] = b[i]! * b[i]!;
    return b;
  });
}

/** Mean-square per 400 ms block, 100 ms hop (BS.1770 gating blocks). */
function gatingBlocks(s: Stereo): number[] {
  const sq = kWeightedSquares(s);
  const block = Math.round(0.4 * SAMPLE_RATE);
  const hop = Math.round(0.1 * SAMPLE_RATE);
  const n = s.l.length;
  const prefix = sq.map(ch => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i]! + ch[i]!;
    return p;
  });
  const out: number[] = [];
  for (let start = 0; start + block <= n; start += hop) {
    let z = 0;
    for (const p of prefix) z += (p[start + block]! - p[start]!) / block;
    out.push(z);
  }
  return out;
}

const lufsOf = (z: number): number => -0.691 + 10 * Math.log10(z);

/** Integrated loudness (LUFS), BS.1770-4 with absolute and relative gates. */
export function integratedLoudness(s: Stereo): number {
  const blocks = gatingBlocks(s).filter(z => lufsOf(z) > -70);
  if (!blocks.length) return -Infinity;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const relGate = lufsOf(mean(blocks)) - 10;
  const gated = blocks.filter(z => lufsOf(z) > relGate);
  return lufsOf(mean(gated));
}

// ---------------------------------------------------------------- True peak

const TP_PHASES = 4;
const TP_TAPS = 48; // per phase

let tpKernel: Float64Array[] | null = null;

/** Polyphase 4x interpolation kernel (Kaiser-windowed sinc). */
function truePeakKernel(): Float64Array[] {
  if (tpKernel) return tpKernel;
  const total = TP_PHASES * TP_TAPS;
  const center = total / 2;
  const beta = 9;
  const i0 = (x: number) => {
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 50; k++) {
      term *= (x / (2 * k)) ** 2;
      sum += term;
    }
    return sum;
  };
  const phases: Float64Array[] = [];
  for (let p = 0; p < TP_PHASES; p++) {
    const h = new Float64Array(TP_TAPS);
    for (let k = 0; k < TP_TAPS; k++) {
      const n = k * TP_PHASES + p;
      const x = (n - center) / TP_PHASES;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const r = (n - center) / center;
      const w =
        Math.abs(r) <= 1 ? i0(beta * Math.sqrt(1 - r * r)) / i0(beta) : 0;
      h[k] = sinc * w;
    }
    phases.push(h);
  }
  tpKernel = phases;
  return phases;
}

/**
 * Per-sample true-peak magnitude envelope: for each input sample, the max
 * |x| over the 4x-oversampled points in (i-1, i]. Returns both channels'
 * max.
 */
export function truePeakEnvelope(s: Stereo): Float32Array {
  const kernel = truePeakKernel();
  const n = s.l.length;
  const out = new Float32Array(n);
  const half = TP_TAPS / 2;
  for (const ch of [s.l, s.r]) {
    for (let i = 0; i < n; i++) {
      let m = Math.abs(ch[i]!);
      for (let p = 1; p < TP_PHASES; p++) {
        const h = kernel[TP_PHASES - p]!;
        // Interpolated point at time (i - 1) + p/4.
        let acc = 0;
        const base = i - half;
        for (let k = 0; k < TP_TAPS; k++) {
          const idx = base + k;
          if (idx >= 0 && idx < n) acc += ch[idx]! * h[k]!;
        }
        m = Math.max(m, Math.abs(acc));
      }
      if (m > out[i]!) out[i] = m;
    }
  }
  return out;
}

export function truePeakDb(s: Stereo): number {
  const env = truePeakEnvelope(s);
  let m = 0;
  for (let i = 0; i < env.length; i++) m = Math.max(m, env[i]!);
  return 20 * Math.log10(m);
}

// ---------------------------------------------------------------- Misc

export const dbToGain = (db: number): number => 10 ** (db / 20);
