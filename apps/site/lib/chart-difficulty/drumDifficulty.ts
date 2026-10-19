/**
 * Deterministic Expert Pro Drums chart-complexity calculator.
 *
 * A TypeScript port of `analysis/drum_difficulty/calculator.py` in the
 * `drum-to-chart` research repo. It estimates the `song.ini` charting-metadata
 * convention (`diff_drums` / `diff_drums_real`, the 0-6 scale) from the chart
 * alone — no audio, no lower difficulty tiers, no model. It is NOT a measure of
 * physical player difficulty.
 *
 * The calculation:
 *  1. Seven transparent chart-only features are extracted from the Expert tier.
 *  2. Each is z-scored against {@link FROZEN_STATS}, corpus constants derived
 *     from 20,013 extracted charts. They are a frozen contract — never
 *     recomputed from the user's chart.
 *  3. `Dc` is the plain mean of the seven z-scores.
 *  4. `calibrated = 4.04 + 1.67 * Dc`, then `clip(floor(calibrated + 0.5), 0, 6)`.
 *
 * An absent or empty Expert tier scores `null`, never 0 — an empty chart is not
 * an easy chart.
 *
 * ## Lane vocabulary mapping
 *
 * The Python module works on an eight-lane transcription vocabulary; this
 * project stores Clone Hero note types plus tom/cymbal flags. Clone Hero shares
 * one pad between a cymbal and a tom, which is exactly what the flag
 * disambiguates:
 *
 * | scan-chart note        | flag      | calculator lane |
 * | ---------------------- | --------- | --------------- |
 * | `kick`                 | —         | `kick`          |
 * | `redDrum`              | —         | `snare`         |
 * | `yellowDrum`           | `cymbal`  | `hihat`         |
 * | `yellowDrum`           | otherwise | `high-tom`      |
 * | `blueDrum`             | `cymbal`  | `ride`          |
 * | `blueDrum`             | otherwise | `mid-tom`       |
 * | `greenDrum`            | `cymbal`  | `crash`         |
 * | `greenDrum`            | otherwise | `floor-tom`     |
 *
 * The Python `ALIASES` entry folding `open-hat` into `hihat` needs no
 * equivalent: Clone Hero has no separate open-hat lane, so the fold is already
 * baked into the yellow-cymbal row above.
 */

import type {NoteEvent, ParsedChart, ParsedTrackData} from '@/lib/chart-edit';
import {noteFlags, noteTypes} from '@/lib/chart-edit';

/** The eight-lane vocabulary the frozen corpus statistics were fitted on. */
export type DrumLane =
  | 'kick'
  | 'snare'
  | 'hihat'
  | 'crash'
  | 'ride'
  | 'high-tom'
  | 'mid-tom'
  | 'floor-tom';

const CYMBALS: ReadonlySet<DrumLane> = new Set<DrumLane>([
  'hihat',
  'crash',
  'ride',
]);
const TOMS: ReadonlySet<DrumLane> = new Set<DrumLane>([
  'high-tom',
  'mid-tom',
  'floor-tom',
]);

/** The seven features that make up the `Dc` axis, in their frozen order. */
export const CORE_FEATURES = [
  'note_density',
  'peak_density_p95',
  'fine_frac',
  'peak_chord_p95',
  'tom_per_min',
  'n_lanes',
  'lane_switch_per_bar',
] as const;

export type CoreFeature = (typeof CORE_FEATURES)[number];

/**
 * Frozen `(mean, standardDeviation)` per core feature, from the Dc corpus
 * contract (20,013 extracted charts with at least eight Expert notes). These
 * are reference constants copied verbatim from the Python module — not
 * recomputed here, and not to be re-derived from any local corpus.
 */
export const FROZEN_STATS: Readonly<
  Record<CoreFeature, readonly [number, number]>
> = {
  note_density: [8.70427985577706, 3.501136644123495],
  peak_density_p95: [13.807297384806152, 6.913654452026965],
  fine_frac: [0.3807170246404795, 0.3041527796728924],
  peak_chord_p95: [2.380057962324489, 0.4861645043467784],
  tom_per_min: [37.84886439002654, 35.77374500353228],
  n_lanes: [7.6078548943186926, 0.7118236510113054],
  lane_switch_per_bar: [1.1017557399455724, 0.755864584112643],
};

/** Affine calibration of the Dc axis onto the 0-6 `song.ini` convention. */
export const CALIBRATED_DC_INTERCEPT = 4.04;
export const CALIBRATED_DC_SLOPE = 1.67;

/**
 * The research-only distilled linear estimator. It is deliberately NOT the
 * shipped score: its held-out gain over Dc sat below the promotion bar in the
 * research plan. Ported so a future upgrade can be compared against the same
 * numbers the Python side reports.
 */
export const DISTILLED_FEATURES = [
  'note_density',
  'peak_density_p95',
  'fine_frac',
  'peak_chord_p95',
  'tom_per_min',
  'n_lanes',
  'lane_switch_per_bar',
  'double_kick_frac',
  'dyn_frac',
] as const;

export type DistilledFeature = (typeof DISTILLED_FEATURES)[number];

export const DISTILLED_STATS: Readonly<
  Record<DistilledFeature, readonly [number, number]>
> = {
  note_density: [8.80057524, 3.65791783],
  peak_density_p95: [13.93328065, 7.25801567],
  fine_frac: [0.38286118, 0.30873393],
  peak_chord_p95: [2.38522997, 0.4870672],
  tom_per_min: [37.30008304, 34.83591486],
  n_lanes: [7.63869828, 0.66446279],
  lane_switch_per_bar: [1.13043758, 0.76953632],
  double_kick_frac: [0.06087301, 0.13041396],
  dyn_frac: [0.01618436, 0.04568935],
};

export const DISTILLED_WEIGHTS: Readonly<Record<DistilledFeature, number>> = {
  note_density: 0.15,
  peak_density_p95: 0.21,
  fine_frac: 0.65,
  peak_chord_p95: 0.01,
  tom_per_min: 0.1,
  n_lanes: 0.2,
  lane_switch_per_bar: 0.13,
  double_kick_frac: 0.09,
  dyn_frac: 0.0,
};

export const DISTILLED_INTERCEPT = 4.07;

/** Every statistic {@link computeFeatures} reports. The seven core features
 *  drive the score; the rest are diagnostics the Python module also emits. */
export interface DrumChartFeatures {
  has_notes: number;
  n_notes: number;
  active_seconds: number;
  note_density: number;
  peak_density_p95: number;
  fine_frac: number;
  peak_chord_p95: number;
  tom_per_min: number;
  n_lanes: number;
  lane_switch_per_bar: number;
  p10_ioi_ms: number;
  burst_frac_100ms: number;
  fastest_stream_ioi_ms: number;
  longest_stream_run: number;
  kick_fraction: number;
  snare_fraction: number;
  cymbal_fraction: number;
  tom_fraction: number;
  double_kick_frac: number;
  dyn_frac: number;
}

/** One flattened drum hit: when it lands, which lane, and its dynamics. */
export interface DrumHit {
  ms: number;
  lane: DrumLane;
  doubleKick: boolean;
  ghost: boolean;
  accent: boolean;
}

/** A tempo marker, reduced to what the calculator reads. */
export interface TempoPoint {
  ms: number;
  bpm: number;
}

// ---------------------------------------------------------------------------
// Chart -> calculator vocabulary
// ---------------------------------------------------------------------------

/** Map one scan-chart drum `NoteEvent` onto the calculator's lane vocabulary,
 *  or `null` for a note type that is not a drum hit. See the module doc. */
export function noteToLane(
  note: Pick<NoteEvent, 'type' | 'flags'>,
): DrumLane | null {
  const isCymbal = (note.flags & noteFlags.cymbal) !== 0;
  switch (note.type) {
    case noteTypes.kick:
      return 'kick';
    case noteTypes.redDrum:
      return 'snare';
    case noteTypes.yellowDrum:
      return isCymbal ? 'hihat' : 'high-tom';
    case noteTypes.blueDrum:
      return isCymbal ? 'ride' : 'mid-tom';
    case noteTypes.greenDrum:
      return isCymbal ? 'crash' : 'floor-tom';
    default:
      return null;
  }
}

/**
 * Flatten a track's grouped note events into the calculator's hit list, sorted
 * by `(ms, lane)` exactly as the Python `_flatten_notes` does — the sort keeps
 * the cymbal-switch sequence deterministic for charts whose groups arrive in
 * an arbitrary order.
 */
export function trackToHits(
  track: Pick<ParsedTrackData, 'noteEventGroups'>,
): DrumHit[] {
  const hits: DrumHit[] = [];
  for (const group of track.noteEventGroups) {
    for (const note of group) {
      const lane = noteToLane(note);
      if (lane === null) continue;
      hits.push({
        ms: note.msTime,
        lane,
        doubleKick: (note.flags & noteFlags.doubleKick) !== 0,
        ghost: (note.flags & noteFlags.ghost) !== 0,
        accent: (note.flags & noteFlags.accent) !== 0,
      });
    }
  }
  hits.sort(
    (a, b) => a.ms - b.ms || (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : 0),
  );
  return hits;
}

/** The chart's tempo markers in the calculator's shape. */
export function chartToTempos(
  chart: Pick<ParsedChart, 'tempos'>,
): TempoPoint[] {
  return chart.tempos.map(tempo => ({
    ms: tempo.msTime,
    bpm: tempo.beatsPerMinute,
  }));
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

/** Linear-interpolated percentile, matching the Python `_percentile`. */
function percentile(values: readonly number[], pct: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const pos = ((ordered.length - 1) * pct) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, ordered.length - 1);
  if (lo === hi) return ordered[lo]!;
  return ordered[lo]! + (ordered[hi]! - ordered[lo]!) * (pos - lo);
}

/** Tempo in effect at `ms`: the last marker at or before it with a positive
 *  BPM, defaulting to 120 when the chart declares nothing usable. */
function bpmAt(tempos: readonly TempoPoint[], ms: number): number {
  let bpm = 120;
  const sorted = [...tempos].sort((a, b) => a.ms - b.ms);
  for (const tempo of sorted) {
    if (tempo.ms > ms) break;
    if (tempo.bpm > 0) bpm = tempo.bpm;
  }
  return bpm;
}

/** Index of the first element of `sorted` strictly greater than `value`,
 *  searching from `lo` — Python's `bisect.bisect_right(a, x, lo=lo)`. */
function bisectRight(
  sorted: readonly number[],
  value: number,
  lo: number,
): number {
  let low = lo;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (value < sorted[mid]!) high = mid;
    else low = mid + 1;
  }
  return low;
}

function emptyFeatures(): DrumChartFeatures {
  return {
    has_notes: 0,
    n_notes: 0,
    active_seconds: 0,
    note_density: 0,
    peak_density_p95: 0,
    fine_frac: 0,
    peak_chord_p95: 0,
    tom_per_min: 0,
    n_lanes: 0,
    lane_switch_per_bar: 0,
    p10_ioi_ms: 0,
    burst_frac_100ms: 0,
    fastest_stream_ioi_ms: 0,
    longest_stream_run: 0,
    kick_fraction: 0,
    snare_fraction: 0,
    cymbal_fraction: 0,
    tom_fraction: 0,
    double_kick_frac: 0,
    dyn_frac: 0,
  };
}

/**
 * Transparent chart-only features for one flattened tier. An empty hit list
 * returns a complete zero-valued vector with `has_notes = 0`, which is the flag
 * the scorer uses to refuse to present an empty chart as a real estimate.
 */
export function computeFeatures(
  hits: readonly DrumHit[],
  tempos: readonly TempoPoint[] = [],
): DrumChartFeatures {
  if (hits.length === 0) return emptyFeatures();

  const lanesByMs = new Map<number, Set<DrumLane>>();
  const countByMs = new Map<number, number>();
  const timesByLane = new Map<DrumLane, number[]>();
  let kickNotes = 0;
  let snareNotes = 0;
  let cymbalNotes = 0;
  let tomNotes = 0;
  let dynamicNotes = 0;
  let doubleKick = 0;

  for (const hit of hits) {
    let lanes = lanesByMs.get(hit.ms);
    if (!lanes) {
      lanes = new Set();
      lanesByMs.set(hit.ms, lanes);
    }
    lanes.add(hit.lane);
    countByMs.set(hit.ms, (countByMs.get(hit.ms) ?? 0) + 1);
    const times = timesByLane.get(hit.lane);
    if (times) times.push(hit.ms);
    else timesByLane.set(hit.lane, [hit.ms]);

    if (hit.lane === 'kick') {
      kickNotes++;
      if (hit.doubleKick) doubleKick++;
    } else if (hit.lane === 'snare') {
      snareNotes++;
    } else if (CYMBALS.has(hit.lane)) {
      cymbalNotes++;
    } else if (TOMS.has(hit.lane)) {
      tomNotes++;
    }
    if (hit.ghost || hit.accent) dynamicNotes++;
  }

  const onsets = [...lanesByMs.keys()].sort((a, b) => a - b);
  const spanMs = Math.max(onsets[onsets.length - 1]! - onsets[0]!, 1);
  const activeSeconds = spanMs / 1000;
  const onsetGaps: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const gap = onsets[i]! - onsets[i - 1]!;
    if (gap > 0) onsetGaps.push(gap);
  }
  // The bar length used for both density normalization and the lane-switch
  // rate assumes 4/4 at the chart's FIRST tempo. That is the historical Dc
  // contract, preserved verbatim so the frozen statistics keep meaning what
  // they meant when they were fitted.
  const bpmFirst = bpmAt(tempos, onsets[0]!);
  const barMs = (4 * 60000) / bpmFirst;

  // Two-bar local density. The Dc contract counts inside a window sized by the
  // LOCAL tempo but normalizes the resulting percentile with the FIRST tempo's
  // bar length; both halves are preserved deliberately.
  const prefixCounts: number[] = [0];
  for (const onset of onsets) {
    prefixCounts.push(
      prefixCounts[prefixCounts.length - 1]! + (countByMs.get(onset) ?? 0),
    );
  }
  const densityCounts: number[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const ms = onsets[i]!;
    const windowMs = (8 * 60000) / bpmAt(tempos, ms);
    const end = bisectRight(onsets, ms + windowMs, i);
    densityCounts.push(prefixCounts[end]! - prefixCounts[i]!);
  }

  // One cymbal per onset is enough for a stable charting-convention proxy.
  const cymbalSequence: DrumLane[] = [];
  for (const ms of onsets) {
    const present = [...lanesByMs.get(ms)!]
      .filter(lane => CYMBALS.has(lane))
      .sort();
    if (present.length > 0) cymbalSequence.push(present[0]!);
  }
  let switches = 0;
  for (let i = 1; i < cymbalSequence.length; i++) {
    if (cymbalSequence[i] !== cymbalSequence[i - 1]) switches++;
  }

  const chordSizes = [...lanesByMs.values()].map(lanes => lanes.size);
  const streamIois: number[] = [];
  let longestStreamRun = 0;
  for (const laneTimes of timesByLane.values()) {
    const unique = [...new Set(laneTimes)].sort((a, b) => a - b);
    let run = 1;
    for (let i = 1; i < unique.length; i++) {
      const ioi = unique[i]! - unique[i - 1]!;
      if (ioi <= 0) continue;
      streamIois.push(ioi);
      if (ioi <= 300) {
        run++;
        longestStreamRun = Math.max(longestStreamRun, run);
      } else {
        run = 1;
      }
    }
  }

  return {
    has_notes: 1,
    n_notes: hits.length,
    active_seconds: activeSeconds,
    note_density: hits.length / activeSeconds,
    peak_density_p95:
      percentile(densityCounts, 95) / Math.max((2 * barMs) / 1000, 1e-6),
    fine_frac:
      onsetGaps.length > 0
        ? onsetGaps.filter(gap => gap <= 125).length / onsetGaps.length
        : 0,
    peak_chord_p95: percentile(chordSizes, 95),
    tom_per_min: (tomNotes / activeSeconds) * 60,
    n_lanes: timesByLane.size,
    lane_switch_per_bar: switches / Math.max(spanMs / Math.max(barMs, 1), 1),
    p10_ioi_ms: percentile(onsetGaps, 10),
    burst_frac_100ms:
      onsetGaps.length > 0
        ? onsetGaps.filter(gap => gap <= 100).length / onsetGaps.length
        : 0,
    fastest_stream_ioi_ms: streamIois.length > 0 ? Math.min(...streamIois) : 0,
    longest_stream_run: longestStreamRun,
    kick_fraction: kickNotes / hits.length,
    snare_fraction: snareNotes / hits.length,
    cymbal_fraction: cymbalNotes / hits.length,
    tom_fraction: tomNotes / hits.length,
    double_kick_frac: kickNotes > 0 ? doubleKick / kickNotes : 0,
    dyn_frac: dynamicNotes / hits.length,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function isEmpty(features: DrumChartFeatures): boolean {
  return !features.has_notes && !features.n_notes;
}

/** The frozen equal-weight `Dc` axis, or `null` for an empty tier. */
export function complexityScore(features: DrumChartFeatures): number | null {
  if (isEmpty(features)) return null;
  let total = 0;
  for (const name of CORE_FEATURES) {
    const [mean, sd] = FROZEN_STATS[name];
    total += (features[name] - mean) / sd;
  }
  return total / CORE_FEATURES.length;
}

/** `Dc` mapped onto the standard 0-6 metadata convention, still continuous. */
export function calibratedComplexityScore(
  features: DrumChartFeatures,
): number | null {
  const score = complexityScore(features);
  if (score === null) return null;
  return CALIBRATED_DC_INTERCEPT + CALIBRATED_DC_SLOPE * score;
}

/** The research-only distilled linear estimate. Not the shipped score. */
export function distilledScore(features: DrumChartFeatures): number | null {
  if (isEmpty(features)) return null;
  let score = DISTILLED_INTERCEPT;
  for (const name of DISTILLED_FEATURES) {
    const [mean, sd] = DISTILLED_STATS[name];
    score += (DISTILLED_WEIGHTS[name] * (features[name] - mean)) / sd;
  }
  return score;
}

/** Round a continuous 0-6 estimate to the integer metadata tier. */
export function estimateTier(score: number | null): number | null {
  if (score === null) return null;
  return Math.min(6, Math.max(0, Math.floor(score + 0.5)));
}

/** Everything the calculator knows about one tier, for diagnostics and UI. */
export interface DrumDifficultyResult {
  features: DrumChartFeatures;
  /** The intrinsic `Dc` axis (mean of seven z-scores). */
  complexityScore: number | null;
  /** `Dc` mapped to the 0-6 convention, before rounding. */
  calibratedComplexityScore: number | null;
  /** Research-only comparison estimate. */
  distilledScore: number | null;
  /** The shipped integer recommendation, or `null` for an empty tier. */
  estimatedDiffDrums: number | null;
  estimatedDiffDrumsReal: number | null;
}

/** Compute features, the continuous scores, and the integer tier for a tier's
 *  flattened hits. */
export function calculateFromHits(
  hits: readonly DrumHit[],
  tempos: readonly TempoPoint[] = [],
): DrumDifficultyResult {
  const features = computeFeatures(hits, tempos);
  const calibrated = calibratedComplexityScore(features);
  const tier = estimateTier(calibrated);
  return {
    features,
    complexityScore: complexityScore(features),
    calibratedComplexityScore: calibrated,
    distilledScore: distilledScore(features),
    estimatedDiffDrums: tier,
    estimatedDiffDrumsReal: tier,
  };
}

/**
 * Run the calculator over a parsed chart's Expert drums track.
 *
 * Returns `null` when the chart has no Expert drums track at all, so callers
 * can distinguish "nothing to score" from a scored result whose tier happens to
 * be `null` because the track exists but is empty.
 */
export function calculateExpertDrumDifficulty(
  chart: Pick<ParsedChart, 'trackData' | 'tempos'>,
): DrumDifficultyResult | null {
  const track = chart.trackData.find(
    candidate =>
      candidate.instrument === 'drums' && candidate.difficulty === 'expert',
  );
  if (!track) return null;
  return calculateFromHits(trackToHits(track), chartToTempos(chart));
}

/**
 * The `song.ini` values recommended for a generated four-lane Pro Drums chart.
 * Both fields get the same score: the calculator is specifically an Expert Pro
 * Drums estimator, and this pipeline authors no separate generic-Drums
 * arrangement to rate differently. `null` means "no recommendation" — never 0.
 */
export function recommendedSongIniScores(
  chart: Pick<ParsedChart, 'trackData' | 'tempos'>,
): {diff_drums: number | null; diff_drums_real: number | null} {
  const result = calculateExpertDrumDifficulty(chart);
  const score = result?.estimatedDiffDrumsReal ?? null;
  return {diff_drums: score, diff_drums_real: score};
}
