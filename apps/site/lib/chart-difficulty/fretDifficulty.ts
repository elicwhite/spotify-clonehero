/**
 * Deterministic Expert 5-fret (guitar / bass) chart-complexity calculator.
 *
 * The sibling of {@link ./drumDifficulty} for `diff_guitar` and `diff_bass`.
 * Like it, this estimates the `song.ini` charting-metadata convention — the
 * 0-6 scale charters actually type into the field — from the chart alone. It is
 * NOT a measure of physical player difficulty, and it is not a claim that the
 * charters who produced the corpus agreed with each other: they disagree with
 * each other by a whole tier more than half the time.
 *
 * Unlike the drum calculator, no frozen upstream implementation exists. The
 * constants here were fitted for this project by the `drum-to-chart` research
 * repo's `analysis/fret_difficulty/`, which is the reference implementation of
 * the feature extraction below and the source of every number in this file.
 *
 * The calculation:
 *  1. Eight transparent chart-only features are extracted from the Expert tier.
 *  2. Each is z-scored against the instrument's {@link FROZEN_STATS}.
 *  3. The intrinsic axis is the WEIGHTED sum of those z-scores. Weights are
 *     signed: sustain-heavy and wide-chord charts read easier on guitar, which
 *     the drum calculator's equal-weight mean could not express.
 *  4. `calibrated = intercept + slope * axis`, then `clip(floor(x + 0.5), 0, 6)`.
 *
 * An absent or empty Expert tier scores `null`, never 0 — an empty chart is not
 * an easy chart.
 *
 * ## Corpus and provenance
 *
 * Fitted on the local Clone Hero corpus (78,456 chart folders; 68,967 parsed
 * with a usable Expert 5-fret track and a declared intensity), deduplicated by
 * (normalized artist, title, charter) to 65,454 guitar rows and 13,890 bass
 * rows carrying a standard 0-6 label and at least {@link MIN_SCORABLE_NOTES}
 * notes. Values above 6 (2,087 guitar rows, up to 6,127,000) are real corpus
 * entries but outside the standard scale, so they were excluded from the fit
 * rather than clipped into 6.
 *
 * Held out over complete song groups across 15 folds, the shipped formula
 * reaches Spearman 0.700 and tier MAE 0.835 on guitar (exact 36.0%, within-one
 * 83.4%) and Spearman 0.635 / tier MAE 0.819 on bass. The label noise floor —
 * how much two charters of the SAME song disagree — is MAE 0.781 on guitar and
 * 0.645 on bass, so the calculator is at, not beyond, the resolution the labels
 * themselves have.
 *
 * ## Lane vocabulary
 *
 * scan-chart note types 1 (open) and 2-6 (green, red, yellow, blue, orange).
 * Everything else on the track is ignored.
 */

import type {NoteEvent, ParsedChart, ParsedTrackData} from '@/lib/chart-edit';
import {noteFlags, noteTypes} from '@/lib/chart-edit';

/** The two 5-fret instruments this calculator rates. */
export type FretInstrument = 'guitar' | 'bass';

export const FRET_INSTRUMENTS: readonly FretInstrument[] = ['guitar', 'bass'];

/**
 * Below this note count a track is a stub, a click-track placeholder, or a
 * partial transcription rather than a rated arrangement. The corpus fit used
 * the same floor, so scoring below it would be extrapolation.
 */
export const MIN_SCORABLE_NOTES = 24;

/** The eight features that make up the intrinsic axis, in their frozen order. */
export const FRET_CORE_FEATURES = [
  'onset_density',
  'peak_density_p95',
  'fine_frac',
  'mean_chord_size',
  'hopo_tap_frac',
  'sustain_frac',
  'anchor_break_per_bar',
  'lane_switch_per_bar',
] as const;

export type FretCoreFeature = (typeof FRET_CORE_FEATURES)[number];

type FrozenStats = Readonly<Record<FretCoreFeature, readonly [number, number]>>;

/**
 * Frozen `(mean, standardDeviation)` per feature, per instrument. Bass is
 * systematically sparser than guitar and got its own statistics: on held-out
 * folds, scoring bass with guitar's constants drops Spearman from 0.635 to
 * 0.573, raises tier MAE from 0.819 to 0.936, and introduces a +0.25 tier bias.
 *
 * These are a frozen contract. They are never recomputed from a user's chart.
 */
export const FROZEN_STATS: Readonly<Record<FretInstrument, FrozenStats>> = {
  guitar: {
    onset_density: [4.691460839553109, 1.9662527016490678],
    peak_density_p95: [11.399989260294353, 11.617941098024916],
    fine_frac: [0.311080190310341, 0.27623307761281907],
    mean_chord_size: [1.339395070522956, 0.302709471690985],
    hopo_tap_frac: [0.27196374364046416, 0.25624137795866403],
    sustain_frac: [0.16292176508205683, 0.14691609497662514],
    anchor_break_per_bar: [1.497161776803422, 1.3474317748253588],
    lane_switch_per_bar: [5.56848541338888, 3.5969545539357717],
  },
  bass: {
    onset_density: [3.5349954356927227, 1.3688995703915898],
    peak_density_p95: [5.743658366838862, 4.227812800372769],
    fine_frac: [0.1091579438361225, 0.18821868289672467],
    mean_chord_size: [1.013377567366656, 0.07582398703955581],
    hopo_tap_frac: [0.10782604902714883, 0.14971102831546937],
    sustain_frac: [0.17867868917378885, 0.1942671948484485],
    anchor_break_per_bar: [1.1092675100869938, 0.9785868702760061],
    lane_switch_per_bar: [3.0529700146738854, 1.890710469299365],
  },
};

/**
 * Signed axis weights, rounded to two decimals so the constants cannot pretend
 * to more precision than the corpus supports.
 *
 * Two of these are worth reading twice. `mean_chord_size` and
 * `anchor_break_per_bar` are NEGATIVE on guitar: the hardest-rated guitar
 * charts in the corpus are fast single-note runs under one hand position, and
 * chord-and-movement charts are rated lower. And `hopo_tap_frac` is exactly
 * zero on guitar — HOPO/tap share correlates with the label on its own
 * (Spearman 0.31) but carries no signal the density terms have not already
 * accounted for, so the fit gave it nothing. That zero is a finding, not a
 * placeholder; on bass the same feature is a real contributor.
 */
export const AXIS_WEIGHTS: Readonly<
  Record<FretInstrument, Readonly<Record<FretCoreFeature, number>>>
> = {
  guitar: {
    onset_density: 0.46,
    peak_density_p95: 0.06,
    fine_frac: 0.47,
    mean_chord_size: -0.14,
    hopo_tap_frac: 0,
    sustain_frac: -0.05,
    anchor_break_per_bar: -0.18,
    lane_switch_per_bar: 0.23,
  },
  bass: {
    onset_density: 0.39,
    peak_density_p95: 0.1,
    fine_frac: 0.29,
    mean_chord_size: 0.03,
    hopo_tap_frac: 0.16,
    sustain_frac: -0.12,
    anchor_break_per_bar: -0.07,
    lane_switch_per_bar: 0.29,
  },
};

/** Affine calibration of each instrument's axis onto the 0-6 convention. */
export const AXIS_CALIBRATION: Readonly<
  Record<FretInstrument, {intercept: number; slope: number}>
> = {
  guitar: {intercept: 3.2, slope: 1.01},
  bass: {intercept: 2.33, slope: 1.0},
};

/** Every statistic {@link computeFretFeatures} reports. The eight core features
 *  drive the score; the rest are diagnostics. */
export interface FretChartFeatures {
  has_notes: number;
  n_notes: number;
  n_onsets: number;
  active_seconds: number;
  onset_density: number;
  note_density: number;
  peak_density_p95: number;
  fine_frac: number;
  burst_frac_100ms: number;
  p10_ioi_ms: number;
  peak_chord_p95: number;
  chord_frac: number;
  mean_chord_size: number;
  hopo_tap_frac: number;
  tap_frac: number;
  open_frac: number;
  sustain_frac: number;
  sustain_time_frac: number;
  n_lanes: number;
  fret_span_mean: number;
  anchor_break_per_bar: number;
  lane_switch_per_bar: number;
}

/** One tick's worth of 5-fret notes: when it lands and which lanes it uses. */
export interface FretOnset {
  ms: number;
  /** scan-chart note types present at this tick. */
  lanes: ReadonlySet<number>;
  notes: readonly Pick<NoteEvent, 'type' | 'flags' | 'msLength'>[];
}

/** A tempo marker, reduced to what the calculator reads. */
export interface TempoPoint {
  ms: number;
  bpm: number;
}

const OPEN = noteTypes.open;
const FRET_MIN = noteTypes.green;
const FRET_MAX = noteTypes.orange;

/**
 * A note is a sustain once it is held past this many milliseconds. The floor
 * discards the tick-rounding noise that `.chart` and `.mid` disagree about on
 * nominally-zero-length notes.
 */
const SUSTAIN_FLOOR_MS = 100;

// ---------------------------------------------------------------------------
// Chart -> calculator vocabulary
// ---------------------------------------------------------------------------

/** True for the six note types a 5-fret track can carry. */
export function isFretLane(type: number): boolean {
  return type === OPEN || (type >= FRET_MIN && type <= FRET_MAX);
}

/**
 * Collapse a track's grouped note events into onsets keyed by millisecond.
 * Grouping by time rather than by the chart's own groups keeps the chord
 * statistics correct for charts whose groups arrive split or out of order.
 */
export function trackToOnsets(
  track: Pick<ParsedTrackData, 'noteEventGroups'>,
): FretOnset[] {
  const byMs = new Map<
    number,
    {ms: number; lanes: Set<number>; notes: NoteEvent[]}
  >();
  for (const group of track.noteEventGroups) {
    for (const note of group) {
      if (!isFretLane(note.type)) continue;
      let onset = byMs.get(note.msTime);
      if (!onset) {
        onset = {ms: note.msTime, lanes: new Set(), notes: []};
        byMs.set(note.msTime, onset);
      }
      onset.lanes.add(note.type);
      onset.notes.push(note);
    }
  }
  return [...byMs.values()].sort((a, b) => a.ms - b.ms);
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

/** Linear-interpolated percentile, matching the drum calculator's helper. */
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
function bpmAt(sortedTempos: readonly TempoPoint[], ms: number): number {
  let bpm = 120;
  for (const tempo of sortedTempos) {
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

function emptyFretFeatures(): FretChartFeatures {
  return {
    has_notes: 0,
    n_notes: 0,
    n_onsets: 0,
    active_seconds: 0,
    onset_density: 0,
    note_density: 0,
    peak_density_p95: 0,
    fine_frac: 0,
    burst_frac_100ms: 0,
    p10_ioi_ms: 0,
    peak_chord_p95: 0,
    chord_frac: 0,
    mean_chord_size: 0,
    hopo_tap_frac: 0,
    tap_frac: 0,
    open_frac: 0,
    sustain_frac: 0,
    sustain_time_frac: 0,
    n_lanes: 0,
    fret_span_mean: 0,
    anchor_break_per_bar: 0,
    lane_switch_per_bar: 0,
  };
}

/**
 * Transparent chart-only features for one flattened tier. An empty onset list
 * returns a complete zero-valued vector with `has_notes = 0`, which is the flag
 * the scorer uses to refuse to present an empty chart as a real estimate.
 */
export function computeFretFeatures(
  onsetList: readonly FretOnset[],
  tempos: readonly TempoPoint[] = [],
): FretChartFeatures {
  if (onsetList.length === 0) return emptyFretFeatures();

  const onsets = [...onsetList].sort((a, b) => a.ms - b.ms);
  const times = onsets.map(onset => onset.ms);
  const spanMs = Math.max(times[times.length - 1]! - times[0]!, 1);
  const activeSeconds = spanMs / 1000;

  let nNotes = 0;
  let hopoTapNotes = 0;
  let tapNotes = 0;
  let sustainNotes = 0;
  let sustainMs = 0;
  let openOnsets = 0;
  let chordOnsets = 0;
  let chordSizeTotal = 0;
  let fretSpanTotal = 0;
  const chordSizes: number[] = [];
  const lanesUsed = new Set<number>();

  for (const onset of onsets) {
    for (const note of onset.notes) {
      nNotes++;
      if ((note.flags & noteFlags.tap) !== 0) {
        tapNotes++;
        hopoTapNotes++;
      } else if ((note.flags & noteFlags.hopo) !== 0) {
        hopoTapNotes++;
      }
      if (note.msLength >= SUSTAIN_FLOOR_MS) {
        sustainNotes++;
        sustainMs += note.msLength;
      }
      lanesUsed.add(note.type);
    }
    const size = onset.lanes.size;
    chordSizes.push(size);
    chordSizeTotal += size;
    if (size >= 2) chordOnsets++;
    if (onset.lanes.has(OPEN)) openOnsets++;
    const frets = [...onset.lanes].filter(
      lane => lane >= FRET_MIN && lane <= FRET_MAX,
    );
    fretSpanTotal +=
      frets.length >= 2 ? Math.max(...frets) - Math.min(...frets) : 0;
  }

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!;
    if (gap > 0) gaps.push(gap);
  }

  // The bar length used for both density normalization and the per-bar rates
  // assumes 4/4 at the chart's FIRST tempo. Same contract as the drum
  // calculator, kept so the frozen statistics keep meaning what they meant when
  // they were fitted.
  const sortedTempos = [...tempos].sort((a, b) => a.ms - b.ms);
  const barMs = (4 * 60000) / bpmAt(sortedTempos, times[0]!);

  // Two-bar local note count: the window is sized by the LOCAL tempo, the
  // resulting percentile normalized by the FIRST tempo's bar. Both halves are
  // preserved deliberately.
  const prefixCounts: number[] = [0];
  for (const onset of onsets) {
    prefixCounts.push(
      prefixCounts[prefixCounts.length - 1]! + onset.notes.length,
    );
  }
  const densityCounts: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const windowMs = (8 * 60000) / bpmAt(sortedTempos, times[i]!);
    const end = bisectRight(times, times[i]! + windowMs, i);
    densityCounts.push(prefixCounts[end]! - prefixCounts[i]!);
  }

  // An anchor break is a transition whose lowest fretted lane moves two or more
  // frets — the movement a player cannot absorb without sliding the hand.
  let anchorBreaks = 0;
  let laneSwitches = 0;
  let previousLow: number | null = null;
  let previousKey: string | null = null;
  for (const onset of onsets) {
    const frets = [...onset.lanes]
      .filter(lane => lane >= FRET_MIN && lane <= FRET_MAX)
      .sort((a, b) => a - b);
    const key = frets.join(',');
    if (previousKey !== null && key !== previousKey) laneSwitches++;
    if (frets.length > 0) {
      const low = frets[0]!;
      if (previousLow !== null && Math.abs(low - previousLow) >= 2)
        anchorBreaks++;
      previousLow = low;
    }
    previousKey = key;
  }
  const bars = Math.max(spanMs / Math.max(barMs, 1), 1);

  return {
    has_notes: 1,
    n_notes: nNotes,
    n_onsets: onsets.length,
    active_seconds: activeSeconds,
    onset_density: onsets.length / activeSeconds,
    note_density: nNotes / activeSeconds,
    peak_density_p95:
      percentile(densityCounts, 95) / Math.max((2 * barMs) / 1000, 1e-6),
    fine_frac:
      gaps.length > 0 ? gaps.filter(gap => gap <= 125).length / gaps.length : 0,
    burst_frac_100ms:
      gaps.length > 0 ? gaps.filter(gap => gap <= 100).length / gaps.length : 0,
    p10_ioi_ms: percentile(gaps, 10),
    peak_chord_p95: percentile(chordSizes, 95),
    chord_frac: chordOnsets / onsets.length,
    mean_chord_size: chordSizeTotal / onsets.length,
    hopo_tap_frac: nNotes > 0 ? hopoTapNotes / nNotes : 0,
    tap_frac: nNotes > 0 ? tapNotes / nNotes : 0,
    open_frac: openOnsets / onsets.length,
    sustain_frac: nNotes > 0 ? sustainNotes / nNotes : 0,
    sustain_time_frac: sustainMs / spanMs,
    n_lanes: lanesUsed.size,
    fret_span_mean: fretSpanTotal / onsets.length,
    anchor_break_per_bar: anchorBreaks / bars,
    lane_switch_per_bar: laneSwitches / bars,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function isScorable(features: FretChartFeatures): boolean {
  return features.has_notes === 1 && features.n_notes >= MIN_SCORABLE_NOTES;
}

/** One feature's signed push on the axis: `weight * z`. */
export function featureContribution(
  features: FretChartFeatures,
  instrument: FretInstrument,
  feature: FretCoreFeature,
): number {
  const [mean, sd] = FROZEN_STATS[instrument][feature];
  return (AXIS_WEIGHTS[instrument][feature] * (features[feature] - mean)) / sd;
}

/** The intrinsic weighted-z axis, or `null` for an empty or stub tier. */
export function complexityScore(
  features: FretChartFeatures,
  instrument: FretInstrument,
): number | null {
  if (!isScorable(features)) return null;
  let total = 0;
  for (const feature of FRET_CORE_FEATURES) {
    total += featureContribution(features, instrument, feature);
  }
  return total;
}

/** The axis mapped onto the standard 0-6 convention, still continuous. */
export function calibratedComplexityScore(
  features: FretChartFeatures,
  instrument: FretInstrument,
): number | null {
  const score = complexityScore(features, instrument);
  if (score === null) return null;
  const {intercept, slope} = AXIS_CALIBRATION[instrument];
  return intercept + slope * score;
}

/** Round a continuous 0-6 estimate to the integer metadata tier. */
export function estimateTier(score: number | null): number | null {
  if (score === null) return null;
  return Math.min(6, Math.max(0, Math.floor(score + 0.5)));
}

/** Everything the calculator knows about one tier, for diagnostics and UI. */
export interface FretDifficultyResult {
  instrument: FretInstrument;
  features: FretChartFeatures;
  /** The intrinsic weighted-z axis. */
  complexityScore: number | null;
  /** The axis mapped to the 0-6 convention, before rounding. */
  calibratedComplexityScore: number | null;
  /** The shipped integer recommendation, or `null` for nothing to score. */
  estimatedDifficulty: number | null;
}

/** Compute features, the continuous score, and the integer tier for a tier's
 *  onsets. */
export function calculateFromOnsets(
  onsets: readonly FretOnset[],
  instrument: FretInstrument,
  tempos: readonly TempoPoint[] = [],
): FretDifficultyResult {
  const features = computeFretFeatures(onsets, tempos);
  const calibrated = calibratedComplexityScore(features, instrument);
  return {
    instrument,
    features,
    complexityScore: complexityScore(features, instrument),
    calibratedComplexityScore: calibrated,
    estimatedDifficulty: estimateTier(calibrated),
  };
}

/**
 * Run the calculator over a parsed chart's Expert track for one instrument.
 *
 * Returns `null` when the chart has no such track at all, so callers can
 * distinguish "nothing to score" from a scored result whose tier happens to be
 * `null` because the track exists but is empty.
 */
export function calculateExpertFretDifficulty(
  chart: Pick<ParsedChart, 'trackData' | 'tempos'>,
  instrument: FretInstrument,
): FretDifficultyResult | null {
  const track = chart.trackData.find(
    candidate =>
      candidate.instrument === instrument && candidate.difficulty === 'expert',
  );
  if (!track) return null;
  return calculateFromOnsets(
    trackToOnsets(track),
    instrument,
    chartToTempos(chart),
  );
}

/**
 * The `song.ini` values recommended for a chart's 5-fret arrangements. `null`
 * means "no recommendation" — never 0.
 */
export function recommendedFretSongIniScores(
  chart: Pick<ParsedChart, 'trackData' | 'tempos'>,
): {diff_guitar: number | null; diff_bass: number | null} {
  return {
    diff_guitar:
      calculateExpertFretDifficulty(chart, 'guitar')?.estimatedDifficulty ??
      null,
    diff_bass:
      calculateExpertFretDifficulty(chart, 'bass')?.estimatedDifficulty ?? null,
  };
}
