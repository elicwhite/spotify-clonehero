/**
 * The one decision the recommended-difficulty UIs share.
 *
 * Given what the chart currently declares, what the calculator recommends, and
 * whether the chart has changed since the declared value was chosen, this
 * module answers "what state is this field in?". Every presentation of a
 * recommendation reads its answer, so the prototypes differ only in how they
 * render these states — never in when they fire.
 *
 * Staleness is the same content-stamp model the Chart Assist cards use, on the
 * same data: the stamp lives in the document's `AssistProvenance`
 * (`lib/chart-editor-core/content-stamps.ts`) beside difficulty-generation and
 * tempo-derived provenance, and the value goes stale when the source track's
 * current stamp no longer matches it. The one difference from `isStampStale`
 * is that there is no "Keep as-is" term: a difficulty is a field the user can
 * simply re-confirm, which re-anchors the stamp, so it needs no separate
 * dismissal to acknowledge. As there, staleness is a recommendation and not a
 * fact — the charter may have deliberately rated the song differently.
 */

/** Which of the five situations a difficulty field is in. */
export type DifficultyRecommendationStatus =
  /** The calculator produced nothing to say (no Expert track for the
   *  instrument, or one too empty to score). The field is a plain manual
   *  value. */
  | 'unavailable'
  /** We have a recommendation and the chart declares no intensity yet. */
  | 'unset'
  /** The declared value is exactly what we would recommend. */
  | 'agrees'
  /** The declared value differs from the recommendation, and the chart has
   *  not changed since it was chosen. */
  | 'disagrees'
  /** The declared value differs from the recommendation AND the chart has
   *  changed since the value was chosen, so the value is probably left over
   *  from an earlier version of the chart. */
  | 'stale';

/** How far apart the declared value and the recommendation are. Off-by-one
 *  is charter noise (same-song charters disagree by a tier ~58% of the time);
 *  three or more tiers is a different claim about the song. */
export type DifficultyDisagreementSeverity =
  | 'none'
  | 'minor'
  | 'moderate'
  | 'major';

export interface DifficultyRecommendationInput {
  /** The chart's declared intensity, or `null` when unset (`song.ini`'s -1). */
  stored: number | null;
  /** The calculator's integer recommendation, or `null` for none. */
  recommended: number | null;
  /** Content stamp of the source track at the moment `stored` was chosen, or
   *  `undefined` when the value's provenance is unknown (e.g. it came in with
   *  an imported chart). Unknown provenance can never be stale — there is no
   *  "since" to compare against. */
  sourceStampAtSet?: string | undefined;
  /** The source track's stamp right now. */
  currentSourceStamp?: string | undefined;
}

export interface DifficultyRecommendationState {
  status: DifficultyRecommendationStatus;
  stored: number | null;
  recommended: number | null;
  /**
   * `recommended - stored`, or `null` when either side is missing. Positive
   * means we think the chart is harder than it claims.
   */
  delta: number | null;
  severity: DifficultyDisagreementSeverity;
  /** True when the chart demonstrably changed after `stored` was chosen. */
  chartChangedSinceSet: boolean;
  /** True when applying the recommendation would actually change the field. */
  canApply: boolean;
}

/** Bucket an absolute tier gap. */
export function disagreementSeverity(
  delta: number | null,
): DifficultyDisagreementSeverity {
  if (delta === null) return 'none';
  const gap = Math.abs(delta);
  if (gap === 0) return 'none';
  if (gap === 1) return 'minor';
  if (gap === 2) return 'moderate';
  return 'major';
}

/**
 * Resolve a difficulty field's recommendation state.
 *
 * Precedence is deliberate:
 *  1. No recommendation wins over everything — we have nothing to say, so we
 *     say nothing rather than implying the declared value is wrong.
 *  2. An unset field is a blank to fill, not a disagreement to argue about.
 *  3. Agreement wins over staleness: if the chart changed but the
 *     recommendation still lands on the declared value, the value is not stale
 *     in any way the user could act on.
 *  4. Only then does a changed chart turn a disagreement into staleness, which
 *     is the difference between "we read this song differently from you" and
 *     "this number describes a chart you have since edited".
 */
export function resolveDifficultyRecommendation({
  stored,
  recommended,
  sourceStampAtSet,
  currentSourceStamp,
}: DifficultyRecommendationInput): DifficultyRecommendationState {
  const chartChangedSinceSet =
    sourceStampAtSet !== undefined &&
    currentSourceStamp !== undefined &&
    sourceStampAtSet !== currentSourceStamp;

  const delta =
    stored !== null && recommended !== null ? recommended - stored : null;

  const base = {
    stored,
    recommended,
    delta,
    severity: disagreementSeverity(delta),
    chartChangedSinceSet,
  };

  if (recommended === null) {
    return {...base, status: 'unavailable', severity: 'none', canApply: false};
  }
  if (stored === null) {
    return {...base, status: 'unset', canApply: true};
  }
  if (stored === recommended) {
    return {...base, status: 'agrees', canApply: false};
  }
  return {
    ...base,
    status: chartChangedSinceSet ? 'stale' : 'disagrees',
    canApply: true,
  };
}

/**
 * The instrument a difficulty field describes. The state itself reads the same
 * for all three, because the decision is the same for all three; this only
 * says which calculator's read a field is showing.
 */
export type RecommendedInstrument = 'drums' | 'guitar' | 'bass';
