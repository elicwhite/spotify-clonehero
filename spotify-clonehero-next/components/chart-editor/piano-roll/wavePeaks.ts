/**
 * Waveform peak mip-map for the piano-roll waveform row (plan 0062 §11 /
 * perf pass).
 *
 * The naive approach — one fixed-resolution amplitude envelope, point-sampled
 * per screen column — looks fine zoomed in but is *wrong* zoomed out: at, say,
 * 200ms/px, a 2px-stride point sample only ever looks at a handful of the
 * ~40 finest-resolution bins that actually map to that column, so transient
 * peaks between samples are silently dropped (visible aliasing / a
 * waveform that looks quieter than the audio actually is).
 *
 * This builds a small mip-map of max-amplitude levels, each double the
 * previous level's bucket width, by max-pooling the level below (so building
 * it is O(n) total, not O(n·levels)). At draw time the caller picks the
 * finest level whose bucket is still ⩽ the on-screen column width and takes
 * the max over every bucket the column spans — "peaks per zoom bucket" (§11):
 * correct at any zoom, and each column only ever scans a small, bounded
 * number of buckets (never the raw sample array).
 *
 * Pure, no canvas/DOM — the component owns sampling per screen column.
 */

/** Finest (level 0) bucket width in ms. */
export const BASE_BIN_MS = 5;

export interface AmpLevel {
  /** Max abs amplitude (0..1) per bucket at this level. */
  peaks: Float32Array;
  /** Bucket width in ms for this level. */
  binMs: number;
}

export interface AmpPyramid {
  levels: AmpLevel[];
  durationMs: number;
}

const EMPTY_PYRAMID: AmpPyramid = {levels: [], durationMs: 0};

/**
 * Build the mip-map from interleaved PCM. `channels` lets a stereo (or
 * multi-channel) source collapse to one amplitude series (max across
 * channels per sample, matching the previous single-level envelope's
 * behavior).
 */
export function buildAmpPyramid(
  audioData: Float32Array | undefined,
  channels: number,
  durationMs: number,
  baseBinMs: number = BASE_BIN_MS,
): AmpPyramid {
  if (!audioData || audioData.length === 0 || durationMs <= 0 || channels < 1) {
    return EMPTY_PYRAMID;
  }
  const totalSamples = Math.floor(audioData.length / channels);
  if (totalSamples <= 0) return EMPTY_PYRAMID;

  const bins = Math.ceil(durationMs / baseBinMs) + 2;
  const level0 = new Float32Array(bins);
  const sampleRate = totalSamples / (durationMs / 1000);
  const samplesPerBin = Math.max(1, (sampleRate * baseBinMs) / 1000);
  for (let i = 0; i < totalSamples; i++) {
    const bin = Math.floor(i / samplesPerBin);
    if (bin >= bins) break;
    const base = i * channels;
    let v = 0;
    for (let c = 0; c < channels; c++) {
      const a = Math.abs(audioData[base + c]);
      if (a > v) v = a;
    }
    if (v > level0[bin]) level0[bin] = v;
  }

  const levels: AmpLevel[] = [{peaks: level0, binMs: baseBinMs}];
  // Keep doubling until a level has few enough buckets to represent the
  // coarsest reasonable zoom-out (a handful of buckets across the song).
  let prev = level0;
  let binMs = baseBinMs;
  while (prev.length > 4) {
    const next = new Float32Array(Math.ceil(prev.length / 2));
    for (let i = 0; i < next.length; i++) {
      const a = prev[i * 2];
      const b = i * 2 + 1 < prev.length ? prev[i * 2 + 1] : 0;
      next[i] = Math.max(a, b);
    }
    binMs *= 2;
    levels.push({peaks: next, binMs});
    prev = next;
  }

  return {levels, durationMs};
}

/** Index of the finest level whose bucket width is ⩽ `targetBinMs` (falls
 *  back to the coarsest level if even the coarsest is finer than needed, or
 *  the finest if none qualify). */
export function pickLevel(pyramid: AmpPyramid, targetBinMs: number): number {
  if (pyramid.levels.length === 0) return -1;
  let best = 0;
  for (let i = 0; i < pyramid.levels.length; i++) {
    if (pyramid.levels[i].binMs <= targetBinMs) best = i;
  }
  return best;
}

/**
 * Max amplitude in `[msA, msB)` — the "peak for this screen column". Picks
 * the level whose bucket width best matches the column's ms span, then
 * scans only the (small, bounded) set of buckets that span overlaps it, so
 * no transient between coarse point-samples is ever missed.
 */
export function sampleAmpRange(
  pyramid: AmpPyramid,
  msA: number,
  msB: number,
): number {
  if (pyramid.levels.length === 0) return 0;
  const span = Math.max(1e-6, msB - msA);
  const levelIdx = pickLevel(pyramid, span);
  const level = pyramid.levels[levelIdx];
  const clampedA = Math.max(0, msA);
  const clampedB = Math.min(pyramid.durationMs, msB);
  if (clampedB <= clampedA) return 0;
  const from = Math.floor(clampedA / level.binMs);
  const to = Math.floor(clampedB / level.binMs);
  let max = 0;
  for (let i = from; i <= to; i++) {
    if (i < 0 || i >= level.peaks.length) continue;
    if (level.peaks[i] > max) max = level.peaks[i];
  }
  return max;
}
