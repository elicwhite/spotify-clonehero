/**
 * GT-free meter-regularity signal for the tempo pipeline.
 *
 * Validated offline on the drum-to-chart heldout set (2026-07-03,
 * autoresearch-tempo/analysis/ts_meter_confidence_probe.py): the fraction
 * of downbeat intervals spanning exactly 4 detected beats separates songs
 * where the predicted grid is trustworthy from songs that need manual
 * time-signature work — median absolute chart F1 0.452 above the 0.7
 * threshold vs 0.000 below it (AUC 0.76 against GT non-4/4 labels; 26% of
 * charted songs flag). The signal fires when the downbeat tracker itself is
 * irregular, which is exactly when the produced barring fails.
 */

export interface MeterStats {
  /** Fraction of downbeat intervals containing exactly 4 beats. */
  frac4: number;
  /** Fraction of downbeat intervals matching the modal beats-per-bar. */
  fracMode: number;
  /** Modal beats-per-bar across the song. */
  mode: number;
  /** Number of downbeat intervals measured. */
  barCount: number;
}

/** Below this frac4, warn that time signatures likely need manual work. */
export const METER_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Compute meter regularity from the beat tracker's own outputs.
 * Returns null when the song is too short to measure (<4 bars / <16 beats).
 */
export function computeMeterStats(
  beatsSec: number[],
  downbeatsSec: number[],
): MeterStats | null {
  if (beatsSec.length < 16 || downbeatsSec.length < 4) return null;

  const counts = new Map<number, number>();
  let barCount = 0;
  let b = 0;
  for (let i = 0; i < downbeatsSec.length - 1; i++) {
    while (b < beatsSec.length && beatsSec[b] < downbeatsSec[i] - 1e-3) b++;
    let e = b;
    while (e < beatsSec.length && beatsSec[e] < downbeatsSec[i + 1] - 1e-3) e++;
    const beatsInBar = e - b;
    counts.set(beatsInBar, (counts.get(beatsInBar) ?? 0) + 1);
    barCount++;
    b = e;
  }
  if (barCount === 0) return null;

  let mode = 4;
  let modeN = 0;
  for (const [k, v] of counts) {
    if (v > modeN) {
      mode = k;
      modeN = v;
    }
  }
  return {
    frac4: (counts.get(4) ?? 0) / barCount,
    fracMode: modeN / barCount,
    mode,
    barCount,
  };
}
