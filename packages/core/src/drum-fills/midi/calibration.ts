/**
 * Latency calibration.
 *
 * The user taps any pad in time with a metronome click. Each tap should land
 * on a click; the measured offset (hit − click) reflects the combined audio +
 * MIDI + human latency. We estimate a single offset as the median of the
 * per-tap deltas, after rejecting outliers (mistimed taps, double hits).
 *
 * Pure logic — no DOM, no audio, no Web MIDI.
 */

export interface CalibrationResult {
  /**
   * Estimated latency offset in milliseconds. Subtract this from raw hit times
   * to align them with the intended (click) times.
   */
  offsetMs: number;
  /** Per-tap deltas (hit − click) that survived outlier rejection. */
  acceptedDeltas: number[];
  /** Deltas that were rejected as outliers. */
  rejectedDeltas: number[];
  /** Number of click/hit pairs considered. */
  sampleCount: number;
}

export interface CalibrationOptions {
  /**
   * Max number of MAD-multiples a delta may sit from the median before being
   * rejected as an outlier. Default 3.
   */
  outlierMadThreshold?: number;
  /**
   * Hard cap on |delta| before pairing. Hits further than this from any click
   * are assumed to be unrelated and dropped. Default 250ms.
   */
  maxPairMs?: number;
}

/** Median of a numeric array. Returns 0 for empty input. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Median absolute deviation about the median. */
export function medianAbsoluteDeviation(values: number[], med: number): number {
  if (values.length === 0) return 0;
  const deviations = values.map(v => Math.abs(v - med));
  return median(deviations);
}

/**
 * Pair each hit to its nearest click and return the signed deltas (hit − click)
 * for pairs within `maxPairMs`. Each click and hit is used at most once,
 * closest-first.
 */
export function pairDeltas(
  clickTimes: number[],
  hitTimes: number[],
  maxPairMs: number,
): number[] {
  const pairs: {clickIdx: number; hitIdx: number; absDelta: number}[] = [];
  for (let c = 0; c < clickTimes.length; c++) {
    for (let h = 0; h < hitTimes.length; h++) {
      const absDelta = Math.abs(hitTimes[h] - clickTimes[c]);
      if (absDelta <= maxPairMs) {
        pairs.push({clickIdx: c, hitIdx: h, absDelta});
      }
    }
  }
  pairs.sort((a, b) => a.absDelta - b.absDelta);

  const clickUsed = new Set<number>();
  const hitUsed = new Set<number>();
  const deltas: number[] = [];
  for (const p of pairs) {
    if (clickUsed.has(p.clickIdx) || hitUsed.has(p.hitIdx)) continue;
    clickUsed.add(p.clickIdx);
    hitUsed.add(p.hitIdx);
    deltas.push(hitTimes[p.hitIdx] - clickTimes[p.clickIdx]);
  }
  return deltas;
}

/**
 * Estimate the latency offset from click times and tap (hit) times.
 *
 * Steps:
 *  1. Pair each hit to its nearest click (within `maxPairMs`).
 *  2. Reject deltas more than `outlierMadThreshold` MADs from the median.
 *  3. Offset = median of the surviving deltas.
 */
export function calibrate(
  clickTimes: number[],
  hitTimes: number[],
  options: CalibrationOptions = {},
): CalibrationResult {
  const {outlierMadThreshold = 3, maxPairMs = 250} = options;

  const deltas = pairDeltas(clickTimes, hitTimes, maxPairMs);

  if (deltas.length === 0) {
    return {
      offsetMs: 0,
      acceptedDeltas: [],
      rejectedDeltas: [],
      sampleCount: 0,
    };
  }

  const med = median(deltas);
  const mad = medianAbsoluteDeviation(deltas, med);

  const accepted: number[] = [];
  const rejected: number[] = [];

  if (mad === 0) {
    // No spread (or too few points to estimate spread): keep everything that
    // equals the median, reject the rest.
    for (const d of deltas) {
      if (d === med) accepted.push(d);
      else rejected.push(d);
    }
  } else {
    const limit = outlierMadThreshold * mad;
    for (const d of deltas) {
      if (Math.abs(d - med) <= limit) accepted.push(d);
      else rejected.push(d);
    }
  }

  const offsetMs = accepted.length > 0 ? median(accepted) : med;

  return {
    offsetMs,
    acceptedDeltas: accepted,
    rejectedDeltas: rejected,
    sampleCount: deltas.length,
  };
}

/** Apply a calibration offset to a raw hit time. */
export function applyCalibration(rawHitMs: number, offsetMs: number): number {
  return rawHitMs - offsetMs;
}
