/**
 * chart-difficulty public API.
 *
 * Chart-only difficulty estimation for `song.ini`'s `diff_*` fields:
 *  - `drumDifficulty` — the frozen Expert Pro Drums calculator (ported from
 *    the `drum-to-chart` research repo).
 *  - `fretDifficulty` - the Expert guitar/bass calculator, fitted for this
 *    project by the `drum-to-chart` research repo's `analysis/fret_difficulty/`.
 *  - `explain` — plain-English naming of the factors behind a recommendation.
 *  - `songIniFields` — canonical `diff_*` field names and which ones a chart
 *    should offer.
 *  - `recommendationState` — the shared "what state is this field in?"
 *    decision every recommendation UI reads.
 *
 * All three instruments produce the same kind of number and deserve the same
 * caution: these estimate the charting-metadata convention, not physical
 * difficulty. Same-song charters disagree by a whole tier roughly half the
 * time, and no calculator here resolves better than that.
 */

export {
  CALIBRATED_DC_INTERCEPT,
  CALIBRATED_DC_SLOPE,
  CORE_FEATURES,
  DISTILLED_FEATURES,
  DISTILLED_INTERCEPT,
  DISTILLED_STATS,
  DISTILLED_WEIGHTS,
  FROZEN_STATS,
  calculateExpertDrumDifficulty,
  calculateFromHits,
  calibratedComplexityScore,
  chartToTempos,
  complexityScore,
  computeFeatures,
  distilledScore,
  estimateTier,
  noteToLane,
  recommendedSongIniScores,
  trackToHits,
} from './drumDifficulty';
export type {
  CoreFeature,
  DistilledFeature,
  DrumChartFeatures,
  DrumDifficultyResult,
  DrumHit,
  DrumLane,
  TempoPoint,
} from './drumDifficulty';

export {
  AXIS_CALIBRATION,
  AXIS_WEIGHTS,
  FRET_CORE_FEATURES,
  FRET_INSTRUMENTS,
  MIN_SCORABLE_NOTES,
  FROZEN_STATS as FRET_FROZEN_STATS,
  calculateExpertFretDifficulty,
  calculateFromOnsets,
  calibratedComplexityScore as calibratedFretComplexityScore,
  complexityScore as fretComplexityScore,
  computeFretFeatures,
  featureContribution,
  isFretLane,
  recommendedFretSongIniScores,
  trackToOnsets,
} from './fretDifficulty';
export type {
  FretChartFeatures,
  FretCoreFeature,
  FretDifficultyResult,
  FretInstrument,
  FretOnset,
} from './fretDifficulty';

export {
  DEFAULT_TOP_FACTOR_COUNT,
  DRUM_FACTOR_NAMES,
  FRET_FACTOR_NAMES,
  describeRecommendationFactors,
  explainRecommendation,
  recommendedDifficulty,
} from './explain';
export type {
  DifficultyExplanation,
  DifficultyFactor,
  ExplainableInstrument,
} from './explain';

export {
  DIFFICULTY_FIELDS,
  DIFFICULTY_FIELD_LABEL,
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  DIFFICULTY_UNSET,
  difficultyFieldsForChart,
  normalizeDifficulty,
  readDifficultyValues,
  toIniDifficulties,
} from './songIniFields';
export type {DifficultyField, DifficultyValues} from './songIniFields';

export {
  disagreementSeverity,
  resolveDifficultyRecommendation,
} from './recommendationState';
export type {
  DifficultyDisagreementSeverity,
  DifficultyRecommendationInput,
  DifficultyRecommendationState,
  DifficultyRecommendationStatus,
  RecommendedInstrument,
} from './recommendationState';
