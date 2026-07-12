/**
 * Per-song confidence gauge (F63).
 *
 * A 2-feature per-song confidence indicator, ported faithfully from the ML
 * repo's research (drum-to-chart PIPELINE_AUDIT.md F63; feature formulas
 * from analysis/product_eval/song_quality_probe.py's `g_tempo_cv` and
 * `m_frac_low`, reference-only — not modified here):
 *
 *   (a) tempo instability: the coefficient of variation (std / mean) of the
 *       predicted tempo map's BPM values across the song. A steady-tempo
 *       song has cv ~= 0; a song with a wildly drifting predicted tempo map
 *       has a high cv, which correlates with worse transcription (grid
 *       mistracking often co-occurs with audio the model also struggles on).
 *   (b) fraction of low-confidence frames: of the notes the model actually
 *       placed, the fraction whose picked-lane sigmoid probability is below
 *       0.6 (the same cutoff research uses for `m_frac_low`).
 *
 * Both are computable entirely browser-side from data the app already has:
 * the model's raw per-note confidence values (persisted to confidence.json)
 * and the predicted tempo map (persisted to synctrack.json) — no server
 * round-trip, no GT chart needed. Research found these two features
 * correlate Spearman 0.62 with the per-song product-edit rate.
 *
 * Tempo instability is only meaningful when the SyncTrack was PREDICTED by
 * this app (audio-only flow). When the user supplied an existing chart
 * (chart-flow feature, path 3a), the grid is theirs, not a prediction — so
 * `tempoInstability` is `null` and the bucket reflects transcription
 * confidence only. Callers (the gauge UI) must surface this distinction.
 *
 * The BUCKET CUTOFFS below (what counts as "high/medium/low") are a product
 * calibration layered on top of the faithfully-ported research features —
 * there is no client-side labeled corpus to fit thresholds against, so
 * these are documented heuristic defaults, not a research-validated
 * calibration.
 */

/** Picked-note confidence below this is "low-confidence" (matches
 * song_quality_probe.py's `m_frac_low` cutoff). */
const LOW_CONFIDENCE_CUTOFF = 0.6;

/** Product-chosen bucket cutoffs (see module doc — not research-calibrated). */
const FRAC_LOW_HIGH_CUTOFF = 0.15; // below this fraction low-conf notes -> good
const FRAC_LOW_LOW_CUTOFF = 0.35; // above this fraction -> flag as low confidence
const TEMPO_CV_HIGH_CUTOFF = 0.05; // below this tempo cv -> stable
const TEMPO_CV_LOW_CUTOFF = 0.15; // above this tempo cv -> flag as unstable

export type ConfidenceBucket = 'high' | 'medium' | 'low';

/**
 * Fraction of the given per-note confidence values that fall below the
 * low-confidence cutoff. Returns 0 for an empty input (no notes = nothing to
 * flag, not "all confident").
 */
export function computeLowConfidenceFraction(
  confidences: Iterable<number>,
): number {
  let n = 0;
  let nLow = 0;
  for (const c of confidences) {
    n++;
    if (c < LOW_CONFIDENCE_CUTOFF) nLow++;
  }
  return n > 0 ? nLow / n : 0;
}

/**
 * Coefficient of variation (std / mean) of a predicted tempo map's BPM
 * values. 0 for a steady/absent tempo map (fewer than 2 tempo events — a
 * single tempo can't be "unstable").
 */
export function computeTempoInstability(bpms: readonly number[]): number {
  if (bpms.length < 2) return 0;
  const mean = bpms.reduce((a, b) => a + b, 0) / bpms.length;
  const variance =
    bpms.reduce((a, b) => a + (b - mean) ** 2, 0) / bpms.length;
  const std = Math.sqrt(variance);
  return std / (mean + 1e-9);
}

/**
 * Buckets the two F63 features into a high/medium/low confidence rating.
 * `tempoInstability === null` means the grid was user-provided, not
 * predicted (chart-flow path 3a) — the bucket then reflects transcription
 * confidence only (see module doc).
 */
export function computeConfidenceBucket(
  fracLowConfidence: number,
  tempoInstability: number | null,
): ConfidenceBucket {
  const tempoUnstable =
    tempoInstability !== null && tempoInstability > TEMPO_CV_LOW_CUTOFF;
  if (fracLowConfidence > FRAC_LOW_LOW_CUTOFF || tempoUnstable) return 'low';

  const tempoStable =
    tempoInstability === null || tempoInstability < TEMPO_CV_HIGH_CUTOFF;
  if (fracLowConfidence < FRAC_LOW_HIGH_CUTOFF && tempoStable) return 'high';

  return 'medium';
}

/** The full per-song confidence result, ready to render. */
export interface SongConfidence {
  fracLowConfidence: number;
  /** null when the grid came from an existing chart (path 3a), not a
   * prediction — see module doc. */
  tempoInstability: number | null;
  bucket: ConfidenceBucket;
}

/**
 * Computes the full F63 confidence gauge for a song.
 *
 * @param confidences - Per-note model confidence values (confidence.json).
 * @param predictedTempoBpms - BPM values from the PREDICTED tempo map
 *   (synctrack.json's `tempos[].bpm`), or `null` when the grid came from an
 *   existing chart rather than a prediction (chart-flow path 3a).
 */
export function computeSongConfidence(
  confidences: Iterable<number>,
  predictedTempoBpms: readonly number[] | null,
): SongConfidence {
  const fracLowConfidence = computeLowConfidenceFraction(confidences);
  const tempoInstability =
    predictedTempoBpms === null
      ? null
      : computeTempoInstability(predictedTempoBpms);
  return {
    fracLowConfidence,
    tempoInstability,
    bucket: computeConfidenceBucket(fracLowConfidence, tempoInstability),
  };
}
