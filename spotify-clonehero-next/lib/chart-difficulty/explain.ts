/**
 * Plain-English naming for what drove a difficulty recommendation.
 *
 * The calculators are transparent by construction — every score is a weighted
 * sum of z-scored chart features — so the copy can name the features instead of
 * asking the user to trust a number. This module turns one chart's feature
 * vector into an ordered list of human-readable factor names, most influential
 * first, so a UI can write "Based on note density, chord complexity and 4 other
 * factors we suggest intensity 3".
 *
 * Ordering is by the ABSOLUTE size of each feature's signed push on the axis
 * (`weight * z`), which is what "contributed most to THIS chart's score" means:
 * a feature sitting at the corpus mean contributed nothing regardless of how
 * heavily it is weighted, and a feature pushing the score down contributed just
 * as much as one pushing it up. `contributions` carries the sign for any UI
 * that wants to say "fewer sustains" rather than just "sustains".
 *
 * Features the instrument's formula weights at exactly zero are omitted
 * entirely — naming a factor that provably did not move the number would be
 * the opposite of building confidence. This is why guitar reports seven
 * factors and bass eight.
 */

import type {ParsedChart} from '@/lib/chart-edit';

import {
  CORE_FEATURES as DRUM_CORE_FEATURES,
  FROZEN_STATS as DRUM_FROZEN_STATS,
  calculateExpertDrumDifficulty,
  type CoreFeature as DrumCoreFeature,
} from './drumDifficulty';
import {
  AXIS_WEIGHTS,
  FRET_CORE_FEATURES,
  calculateExpertFretDifficulty,
  featureContribution,
  type FretCoreFeature,
  type FretInstrument,
} from './fretDifficulty';

/** Every instrument that has a recommendation to explain. */
export type ExplainableInstrument = 'drums' | FretInstrument;

/**
 * Short, user-facing names for the drum calculator's seven features.
 *
 * Each name is a neutral dimension, never an assertion about the chart: the
 * ranking is by absolute contribution, so a factor can appear because the
 * chart sits LOW on it. "subdivision speed" is true of a chart at any tier;
 * "fast subdivisions" would not be.
 */
export const DRUM_FACTOR_NAMES: Readonly<Record<DrumCoreFeature, string>> = {
  note_density: 'note density',
  peak_density_p95: 'busiest sections',
  fine_frac: 'subdivision speed',
  peak_chord_p95: 'simultaneous hits',
  tom_per_min: 'tom work',
  n_lanes: 'kit coverage',
  lane_switch_per_bar: 'cymbal switching',
};

/** Short, user-facing names for the 5-fret calculator's eight features, as
 *  neutral dimensions rather than claims — see {@link DRUM_FACTOR_NAMES}. */
export const FRET_FACTOR_NAMES: Readonly<Record<FretCoreFeature, string>> = {
  onset_density: 'note density',
  peak_density_p95: 'busiest sections',
  fine_frac: 'strumming speed',
  mean_chord_size: 'chord complexity',
  hopo_tap_frac: 'hammer-ons and taps',
  sustain_frac: 'sustained notes',
  anchor_break_per_bar: 'hand movement',
  lane_switch_per_bar: 'fret changes',
};

/** One factor's signed influence on this chart's score. */
export interface DifficultyFactor {
  /** The internal feature name, for diagnostics. */
  feature: string;
  /** The plain-English name a UI should print. */
  name: string;
  /**
   * The feature's signed push on the intrinsic axis. Positive pushed the
   * recommendation up, negative pushed it down.
   */
  contribution: number;
}

export interface DifficultyExplanation {
  instrument: ExplainableInstrument;
  /** The integer recommendation being explained. */
  recommended: number | null;
  /** Every contributing factor, most influential first. */
  factors: readonly DifficultyFactor[];
  /** The names of the leading factors, for the sentence's first clause. */
  topFactors: string[];
  /** How many contributing factors `topFactors` left out. */
  otherFactorCount: number;
}

/** How many factors {@link explainRecommendation} names by default. */
export const DEFAULT_TOP_FACTOR_COUNT = 2;

function rank(factors: DifficultyFactor[]): DifficultyFactor[] {
  // Ties break on the frozen feature order so the copy is deterministic.
  return [...factors].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );
}

function drumFactors(chart: Pick<ParsedChart, 'trackData' | 'tempos'>) {
  const result = calculateExpertDrumDifficulty(chart);
  if (!result || result.complexityScore === null) return null;
  const factors = DRUM_CORE_FEATURES.map(feature => {
    const [mean, sd] = DRUM_FROZEN_STATS[feature];
    return {
      feature,
      name: DRUM_FACTOR_NAMES[feature],
      // Dc is the plain mean of the seven z-scores, so each feature's push is
      // its z-score divided by the feature count.
      contribution:
        (result.features[feature] - mean) / sd / DRUM_CORE_FEATURES.length,
    };
  });
  return {recommended: result.estimatedDiffDrumsReal, factors};
}

function fretFactors(
  chart: Pick<ParsedChart, 'trackData' | 'tempos'>,
  instrument: FretInstrument,
) {
  const result = calculateExpertFretDifficulty(chart, instrument);
  if (!result || result.complexityScore === null) return null;
  const factors = FRET_CORE_FEATURES.filter(
    feature => AXIS_WEIGHTS[instrument][feature] !== 0,
  ).map(feature => ({
    feature,
    name: FRET_FACTOR_NAMES[feature],
    contribution: featureContribution(result.features, instrument, feature),
  }));
  return {recommended: result.estimatedDifficulty, factors};
}

/**
 * The integer recommendation for one instrument, or `null` when there is none.
 * The one entry point a difficulty field needs to feed
 * {@link ./recommendationState.resolveDifficultyRecommendation}, whichever of
 * the three instruments it describes.
 */
export function recommendedDifficulty(
  chart: Pick<ParsedChart, 'trackData' | 'tempos'>,
  instrument: ExplainableInstrument,
): number | null {
  if (instrument === 'drums') {
    return calculateExpertDrumDifficulty(chart)?.estimatedDiffDrumsReal ?? null;
  }
  return (
    calculateExpertFretDifficulty(chart, instrument)?.estimatedDifficulty ??
    null
  );
}

/**
 * Name the factors behind one instrument's recommendation, ordered by how much
 * each moved THIS chart's score.
 *
 * Returns `null` whenever the calculator has no recommendation to explain —
 * no Expert track for the instrument, or a track too empty to score. That is
 * the same "we have nothing to say" case
 * {@link ./recommendationState.resolveDifficultyRecommendation} reports as
 * `unavailable`, and callers should render nothing rather than a factor list
 * for a score that does not exist.
 */
export function explainRecommendation(
  chart: Pick<ParsedChart, 'trackData' | 'tempos'>,
  instrument: ExplainableInstrument,
  topCount: number = DEFAULT_TOP_FACTOR_COUNT,
): DifficultyExplanation | null {
  const computed =
    instrument === 'drums'
      ? drumFactors(chart)
      : fretFactors(chart, instrument);
  if (!computed) return null;

  const ordered = rank(computed.factors);
  const named = Math.max(0, Math.min(topCount, ordered.length));
  return {
    instrument,
    recommended: computed.recommended,
    factors: ordered,
    topFactors: ordered.slice(0, named).map(factor => factor.name),
    otherFactorCount: ordered.length - named,
  };
}

/** Join a list the way a sentence does: no list at all, "a and b", or
 *  "a, b and c" — the final conjunction replaces the last comma. */
function joinClause(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The sentence a difficulty field prints under its suggestion: what drove the
 * number, then the number.
 *
 * Named factors come first in contribution order, and whatever the caller's
 * `topCount` left out is summarised as "and N other factors" — dropped
 * entirely when nothing was left out, so a fully-named explanation does not
 * end in "and 0 other factors".
 *
 * Returns `null` when there is nothing to describe, which is the same case
 * {@link explainRecommendation} returns `null` for: a UI with no recommendation
 * should print no sentence.
 */
export function describeRecommendationFactors(
  explanation: DifficultyExplanation | null,
): string | null {
  if (!explanation || explanation.recommended === null) return null;
  const {topFactors, otherFactorCount, recommended} = explanation;
  if (topFactors.length === 0 && otherFactorCount === 0) return null;

  const clause = joinClause([
    ...topFactors,
    ...(otherFactorCount > 0
      ? [`${otherFactorCount} other factor${otherFactorCount === 1 ? '' : 's'}`]
      : []),
  ]);
  return `Based on ${clause} we suggest intensity ${recommended}.`;
}
