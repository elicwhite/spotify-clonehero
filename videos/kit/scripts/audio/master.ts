/**
 * Mastering: one static gain to hit the loudness target, plus a transparent
 * look-ahead true-peak limiter only if the peaks demand it. The same gain
 * curve is applied to every stem, so the stems still sum to the master.
 */
import {
  dbToGain,
  integratedLoudness,
  truePeakDb,
  truePeakEnvelope,
} from './dsp';
import {SAMPLE_RATE, allocStereo, type Stereo} from './pcm';

/** The plain sum of the stems, as long as the longest (a shorter one ends in silence). */
export function sumStems(stems: readonly Stereo[]): Stereo {
  if (!stems.length) throw new Error('sumStems: no stems');
  let n = 0;
  for (const s of stems) n = Math.max(n, s.l.length);
  const out = allocStereo(n);
  for (const s of stems) {
    for (let i = 0; i < s.l.length; i++) {
      out.l[i] = out.l[i]! + s.l[i]!;
      out.r[i] = out.r[i]! + s.r[i]!;
    }
  }
  return out;
}

/** `s` times a gain: one number, or a per-sample curve. */
export function scaled(s: Stereo, g: number | Float32Array): Stereo {
  const out = allocStereo(s.l.length);
  for (let i = 0; i < s.l.length; i++) {
    const k = typeof g === 'number' ? g : g[i]!;
    out.l[i] = s.l[i]! * k;
    out.r[i] = s.r[i]! * k;
  }
  return out;
}

interface LimiterSpec {
  ceilingDb: number;
  lookaheadSec: number;
  releaseSec: number;
}

/**
 * Gain-reduction curve (0..1) that keeps the true peak of `s` under the
 * ceiling. A forward-looking minimum followed by a moving average of the
 * same length guarantees gain <= required gain at every sample while never
 * changing faster than the look-ahead allows; release is a one-pole return
 * to unity. `env` is `s`'s true-peak envelope, when the caller has it.
 */
function limiterCurve(
  s: Stereo,
  spec: LimiterSpec,
  env: Float32Array = truePeakEnvelope(s),
): Float32Array {
  const n = s.l.length;
  const ceiling = dbToGain(spec.ceilingDb);
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++)
    req[i] = env[i]! > ceiling ? ceiling / env[i]! : 1;
  const L = Math.max(1, Math.round(spec.lookaheadSec * SAMPLE_RATE));
  // Forward moving minimum over [i, i + L - 1] (monotonic deque).
  const fmin = new Float32Array(n);
  const dq: number[] = [];
  let head = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (dq.length > head && req[dq[dq.length - 1]!]! >= req[i]!) dq.pop();
    dq.push(i);
    while (dq[head]! > i + L - 1) head++;
    fmin[i] = req[dq[head]!]!;
  }
  // Backward moving average over [i - L + 1, i]. Before the first sample the
  // window is padded with fmin[0], which is <= req[i] for every i < L, so the
  // guarantee holds at the leading edge too.
  const avg = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += fmin[i]!;
    if (i >= L) acc -= fmin[i - L]!;
    avg[i] = i >= L - 1 ? acc / L : (acc + (L - i - 1) * fmin[0]!) / L;
  }
  const rel = 1 - Math.exp(-1 / (spec.releaseSec * SAMPLE_RATE));
  const g = new Float32Array(n);
  let prev = 1;
  for (let i = 0; i < n; i++) {
    const recovered = prev + (1 - prev) * rel;
    prev = Math.min(avg[i]!, recovered);
    g[i] = prev;
  }
  return g;
}

export interface MasterResult {
  /** Static gain applied to every stem, dB. */
  gainDb: number;
  /** Per-sample limiter gain, or null when no limiting was needed. */
  limiter: Float32Array | null;
  lufs: number;
  truePeakDb: number;
  maxReductionDb: number;
}

/**
 * Finds the static gain (and limiter curve, if needed) that puts the stem sum
 * at `targetLufs` with true peak <= `ceilingDb`. The gain and the curve
 * returned always belong together, and the numbers are measured on their
 * product. When the limiting is so heavy that the curve's own modulation
 * pushes a peak over the ceiling, the limiter aims lower and tries again;
 * callers still check the result.
 */
export function master(
  stems: readonly Stereo[],
  targetLufs: number,
  ceilingDb: number,
): MasterResult {
  const mix = sumStems(stems);
  const loudness = integratedLoudness(mix);
  if (!Number.isFinite(loudness)) {
    throw new Error(
      'master: the mix is silent (no block above the -70 LUFS gate)',
    );
  }
  // The true-peak envelope scales with the gain, so it is measured once.
  const env = truePeakEnvelope(mix);
  let envPeak = 0;
  for (let i = 0; i < env.length; i++) envPeak = Math.max(envPeak, env[i]!);
  // Leave a little room for the 24-bit rounding and the curve's own
  // modulation; the final true peak is verified on the written file.
  const spec: LimiterSpec = {
    ceilingDb: ceilingDb - 0.3,
    lookaheadSec: 0.004,
    releaseSec: 0.12,
  };
  let gainDb = targetLufs - loudness;
  let result: MasterResult | null = null;
  for (let iter = 0; iter < 8; iter++) {
    const g = dbToGain(gainDb);
    const pre = scaled(mix, g);
    if (20 * Math.log10(envPeak * g) <= spec.ceilingDb) {
      // The gain alone fits under the ceiling: no limiting.
      return {
        gainDb,
        limiter: null,
        lufs: integratedLoudness(pre),
        truePeakDb: truePeakDb(pre),
        maxReductionDb: 0,
      };
    }
    const limiter = limiterCurve(
      pre,
      spec,
      env.map(v => v * g),
    );
    const out = scaled(pre, limiter);
    const lufs = integratedLoudness(out);
    const peak = truePeakDb(out);
    let maxReductionDb = 0;
    for (let i = 0; i < limiter.length; i++) {
      maxReductionDb = Math.min(maxReductionDb, 20 * Math.log10(limiter[i]!));
    }
    result = {gainDb, limiter, lufs, truePeakDb: peak, maxReductionDb};
    const onTarget = Math.abs(targetLufs - lufs) < 0.02;
    if (onTarget && peak <= ceilingDb) break;
    if (peak > ceilingDb) spec.ceilingDb -= peak - ceilingDb + 0.05;
    gainDb += targetLufs - lufs;
  }
  return result!;
}

/**
 * Applies a master result to every stem in place: the same gain curve on
 * each, so the stems still sum to the mastered mix.
 */
export function applyMaster(stems: readonly Stereo[], m: MasterResult): void {
  const g = dbToGain(m.gainDb);
  for (const s of stems) {
    for (let i = 0; i < s.l.length; i++) {
      const k = g * (m.limiter ? m.limiter[i]! : 1);
      s.l[i] = s.l[i]! * k;
      s.r[i] = s.r[i]! * k;
    }
  }
}
