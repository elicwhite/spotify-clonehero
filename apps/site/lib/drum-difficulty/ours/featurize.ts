/**
 * "Ours" v3 ("rb4_best") feature vector — a faithful TS port of the Python
 * featurizer that the shipped GBM was trained against, so the TS survive /
 * relane heads see byte-identical inputs to the Python ones.
 *
 * The 59-column vector is `reduction_probe.extract_song_features` /
 * `build_matrix` (v1's 43 columns) extended by
 * `relane_model_export_snapshot.extract_song_features_v2` / `build_matrix_v2`
 * (10 `chord_has_<lane>` columns) — v1+v2's base 53 columns — MINUS three
 * absolute-position columns (`position_in_song`, `section_progress`,
 * `section_frac`, dropped 2026-07-20 for position-invariance: an identical
 * Expert groove should featurize identically regardless of where in the song
 * it sits, which is what the new canonicalization pass (see
 * `../consistencyMetric.ts`) relies on) — PLUS 9 `aug_*` "AUG_FEATS v7"
 * structural columns appended at the end, per
 * `scratch_rb4_export/train_pinned_16b2fe0.py`'s `annotate_features` /
 * `build_matrix_aug`. Column order and every numeric definition (density
 * window, gap clamp, beat alignment epsilon, measure-relative beat) mirror
 * the Python exactly — see
 * `~/projects/drum-to-chart/analysis/hopcat_reduction_eval/`.
 *
 * Three documented quirks are preserved deliberately, not bugs:
 *  - `section_prechorus` appears twice (`SECTION_KEYWORDS` matches
 *    "pre-chorus" and "prechorus" as separate always-equal one-hots).
 *    Removing the duplicate would misalign every downstream `feature_idx`.
 *  - `era` is hardcoded to `RB4` for every uploaded chart (plan's locked
 *    inference-time decision), so `era_RB4` is always 1, the rest always 0.
 *  - dropping the 3 position columns removes them from their ORIGINAL
 *    positions in the column order (shifting every column after them), not
 *    just from the end — `aligned_*`/`lane_*`/etc. now sit at different
 *    indices than in v2. See `feature_names_v5.json` for the exact order.
 *
 * The feature vector is tier-independent (no label term), so a chart is
 * featurized once and the survive/relane heads for all three tiers read the
 * same rows.
 */

import {noteFlags} from '@eliwhite/scan-chart';
import type {ParsedChart} from '../../preview/chorus-chart-processing';
import type {DrumLane, RawDrumChart} from '../types';
import {bisectLeft, bisectRight, median, pythonRound} from './numeric';

// ---------------------------------------------------------------------------
// Vocabularies + column order (must stay identical to feature_names_v2.json)
// ---------------------------------------------------------------------------

/** `reduction_probe.LANE_VOCAB`. */
export const LANE_VOCAB = [
  'kick',
  'snare',
  'hihat',
  'open-hat',
  'high-tom',
  'mid-tom',
  'floor-tom',
  'crash',
  'ride',
] as const;

/** `reduction_probe.SECTION_KEYWORDS` — `[keyword, label]`, order-significant.
 * `prechorus` appears twice on purpose (see file header). */
const SECTION_KEYWORDS: readonly [string, string][] = [
  ['intro', 'intro'],
  ['outro', 'outro'],
  ['pre-chorus', 'prechorus'],
  ['prechorus', 'prechorus'],
  ['chorus', 'chorus'],
  ['verse', 'verse'],
  ['bridge', 'bridge'],
  ['solo', 'solo'],
  ['breakdown', 'breakdown'],
  ['interlude', 'interlude'],
  ['fill', 'fill'],
];

const SECTION_VOCAB: readonly string[] = [
  ...SECTION_KEYWORDS.map(([, label]) => label),
  'other',
];

const ERA_VOCAB: readonly string[] = ['RB1', 'RB2', 'RB3', 'RB4', 'other'];

/** Hardcoded inference-time era (plan's locked decision). */
const FIXED_ERA = 'RB4';

/** `build_matrix_aug`'s base numeric columns — v1/v2's `NUMERIC_FEATS` minus
 * `DROP_POSITION_FEATS` (`section_progress`, `section_frac`,
 * `position_in_song`), removed from their original positions (not appended
 * at the end), matching `feature_names_v5.json`'s exact order. */
const NUMERIC_FEATS: readonly string[] = [
  'chord_size',
  'beat_in_measure',
  'beats_per_measure',
  'is_downbeat',
  'local_density_500ms',
  'gap_prev_ms',
  'gap_next_ms',
  'ghost',
  'accent',
  'flam',
  'aligned_half',
  'aligned_quarter',
  'aligned_eighth',
];

const LANE_COLS = [...LANE_VOCAB, 'other'];
const CHORD_FEATS = LANE_COLS.map(lv => `chord_has_${lv}`);

/** `train_pinned_16b2fe0.AUG_FEATS` ("v7") — appended after the base +
 * chord_has columns. Computed PER SONG (not per-note in isolation) over the
 * full Expert-lane row set — see the aug-feature block in {@link featurizeSong}. */
const AUG_FEATS: readonly string[] = [
  'aug_dist_backbone_ms',
  'aug_density_ratio',
  'aug_samelane_prev_ms',
  'aug_samelane_next_ms',
  'aug_chord_priority',
  'aug_density_100ms',
  'aug_density_1500ms',
  'aug_beat_frac',
  'aug_lane_frac_500ms',
];

/** The full 59-column name list, in the exact order the models index by. */
export const FEATURE_NAMES: readonly string[] = [
  ...NUMERIC_FEATS,
  ...LANE_COLS.map(l => `lane_${l}`),
  ...SECTION_VOCAB.map(s => `section_${s}`),
  ...ERA_VOCAB.map(e => `era_${e}`),
  ...CHORD_FEATS,
  ...AUG_FEATS,
];

// ---------------------------------------------------------------------------
// Families (manifest.json `families`)
// ---------------------------------------------------------------------------

export type Family = 'cymbal' | 'tom' | 'fixed';

const CYMBAL_FAMILY = ['hihat', 'open-hat', 'crash', 'ride'];
const TOM_FAMILY = ['high-tom', 'mid-tom', 'floor-tom'];
const FAMILY_OF_LANE = new Map<string, Family>();
for (const l of CYMBAL_FAMILY) FAMILY_OF_LANE.set(l, 'cymbal');
for (const l of TOM_FAMILY) FAMILY_OF_LANE.set(l, 'tom');

export function familyOfLane(lane: string): Family {
  return FAMILY_OF_LANE.get(lane) ?? 'fixed';
}

// ---------------------------------------------------------------------------
// Numeric constants (reduction_probe.py + editrate.py)
// ---------------------------------------------------------------------------

const GRID_DIVS: readonly [string, number][] = [
  ['half', 2.0],
  ['quarter', 1.0],
  ['eighth', 0.5],
];
const ALIGN_EPS_BEATS = 0.04;
/** editrate.EPS_MS — the "same tick" ms quantum used for chord grouping. */
const EPS_MS = 0.5;
const DENSITY_HALF_WINDOW_MS = 250.0;
const GAP_CLAMP_MS = 5000.0;

/** `train_pinned_16b2fe0.BACKBONE_LANES` — never relaned, in either v1/v2/v3. */
const BACKBONE_LANES = new Set(['kick', 'snare']);
/** AUG_FEATS clamp for `aug_dist_backbone_ms`/`aug_samelane_{prev,next}_ms`
 * (same 5000ms clamp value as `gap_prev_ms`/`gap_next_ms`, defined
 * separately in Python — kept as its own constant here for fidelity). */
const AUG_GAP_CLAMP_MS = 5000.0;
const AUG_DENSITY_100_HALF_MS = 100.0;
const AUG_DENSITY_1500_HALF_MS = 1500.0;
const AUG_LANE_FRAC_HALF_MS = 500.0;

/** `train_pinned_16b2fe0._LANE_PRIORITY` — lower = more likely to survive a
 * reduction (backbone first, then cymbals, then toms, "other" last). Used by
 * `aug_chord_priority` only; independent of the relane `families`. */
const LANE_PRIORITY: Readonly<Record<string, number>> = {
  kick: 0,
  snare: 1,
  crash: 2,
  ride: 3,
  hihat: 4,
  'open-hat': 5,
  'floor-tom': 6,
  'mid-tom': 7,
  'high-tom': 8,
  other: 9,
};
function lanePriority(lane: string): number {
  return LANE_PRIORITY[lane] ?? 9;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface OursNoteInput {
  /** Source-resolution chart tick (Ours never rescales; output keeps this). */
  tick: number;
  /** scan-chart tempo-mapped ms — the same value the Python featurizer read. */
  ms: number;
  /** Fully-resolved Pro lane (tom/cymbal + disco already applied). */
  lane: DrumLane;
  ghost: boolean;
  accent: boolean;
  flam: boolean;
}

export interface OursSongInput {
  notes: OursNoteInput[];
  tempos: {ms: number; bpm: number}[];
  timeSignatures: {ms: number; numerator: number; denominator: number}[];
  sections: {ms: number; name: string}[];
  /** Source chart ticks-per-quarter — needed only to reconstruct a `tick` for
   * canonicalization's donor-copied notes (see `reduce.ts`). */
  resolution: number;
}

/** One featurized Expert note: bookkeeping fields + the 53-column vector. */
export interface FeatureRow {
  tick: number;
  ms: number;
  /** Original resolved lane, normalized to the vocab ("other" if unknown). */
  lane: string;
  family: Family;
  features: number[];
}

// ---------------------------------------------------------------------------
// Timing closures (build_ms_to_beat / build_measure_fn / build_section_fn)
// ---------------------------------------------------------------------------

/** Exported for {@link ../reduce.ts}'s canonicalization step, which must
 * reconstruct a source-resolution `tick` for donor-copied notes (canonicalize
 * only carries ms/lane — see `consistencyMetric.ts`). */
export function buildMsToBeat(
  tempos: {ms: number; bpm: number}[],
): (ms: number) => number {
  let t = tempos.slice().sort((a, b) => a.ms - b.ms);
  if (t.length === 0 || t[0].ms > 0) {
    t = [{ms: 0, bpm: t.length ? t[0].bpm : 120.0}, ...t];
  }
  const anchorsMs: number[] = [];
  const anchorsBeat: number[] = [];
  let cumBeats = 0.0;
  for (let i = 0; i < t.length; i++) {
    anchorsMs.push(t[i].ms);
    anchorsBeat.push(cumBeats);
    if (i + 1 < t.length) {
      const durMs = t[i + 1].ms - t[i].ms;
      cumBeats += (durMs * t[i].bpm) / 60000.0;
    }
  }
  const bpms = t.map(x => x.bpm);
  return (ms: number) => {
    let idx = bisectRight(anchorsMs, ms) - 1;
    if (idx < 0) idx = 0;
    return anchorsBeat[idx] + ((ms - anchorsMs[idx]) * bpms[idx]) / 60000.0;
  };
}

function buildMeasureFn(
  timeSigs: {ms: number; numerator: number; denominator: number}[],
  msToBeat: (ms: number) => number,
): (beat: number) => [number, number] {
  let ts = timeSigs.slice().sort((a, b) => a.ms - b.ms);
  if (ts.length === 0) ts = [{ms: 0, numerator: 4, denominator: 4}];
  const segs: [number, number][] = ts.map(t => [
    msToBeat(t.ms),
    (t.numerator * 4.0) / t.denominator,
  ]);
  const segStarts = segs.map(s => s[0]);
  return (beat: number) => {
    let idx = bisectRight(segStarts, beat) - 1;
    if (idx < 0) idx = 0;
    const [segStart, bpm] = segs[idx];
    const rel = beat - segStart;
    const beatInMeasure = bpm > 0 ? rel % bpm : 0.0;
    return [beatInMeasure, bpm];
  };
}

function sectionType(name: string): string {
  const n = (name || '').toLowerCase();
  for (const [kw, label] of SECTION_KEYWORDS) {
    if (n.includes(kw)) return label;
  }
  return 'other';
}

function buildSectionFn(
  sections: {ms: number; name: string}[],
  songEndMs: number,
): (ms: number) => [string, number, number] {
  const secs =
    sections.length > 0
      ? sections.slice().sort((a, b) => a.ms - b.ms)
      : [{ms: 0, name: ''}];
  const starts = secs.map(s => s.ms);
  return (ms: number) => {
    let idx = bisectRight(starts, ms) - 1;
    if (idx < 0) idx = 0;
    const start = secs[idx].ms;
    const end = idx + 1 < secs.length ? secs[idx + 1].ms : songEndMs;
    const frac = end > start ? (ms - start) / (end - start) : 0.0;
    return [
      sectionType(secs[idx].name),
      idx / Math.max(1, secs.length - 1),
      frac,
    ];
  };
}

function alignFlags(beatPos: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, div] of GRID_DIVS) {
    const frac = beatPos % div;
    out[`aligned_${name}`] =
      frac < ALIGN_EPS_BEATS || div - frac < ALIGN_EPS_BEATS ? 1 : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Featurizer
// ---------------------------------------------------------------------------

function normalizeLane(lane: string): string {
  return (LANE_VOCAB as readonly string[]).includes(lane) ? lane : 'other';
}

interface FlatRow {
  ms: number;
  tick: number;
  lane: string;
  chordSize: number;
  ghost: boolean;
  accent: boolean;
  flam: boolean;
}

/**
 * Featurize one chart's Expert notes into {@link FeatureRow}s, one per note,
 * matching the Python row order (ascending by `(ms, lane)`).
 */
export function featurizeSong(input: OursSongInput): FeatureRow[] {
  // Group notes into per-tick chords (flatten_expert's (ms, entries) shape).
  const byTick = new Map<number, OursNoteInput[]>();
  for (const n of input.notes) {
    const arr = byTick.get(n.tick);
    if (arr) arr.push(n);
    else byTick.set(n.tick, [n]);
  }

  const expRows: FlatRow[] = [];
  for (const [tick, entries] of byTick) {
    const chordSize = entries.length;
    for (const e of entries) {
      expRows.push({
        ms: e.ms,
        tick,
        lane: normalizeLane(e.lane),
        chordSize,
        ghost: e.ghost,
        accent: e.accent,
        flam: e.flam,
      });
    }
  }
  if (expRows.length === 0) return [];
  expRows.sort(
    (a, b) => a.ms - b.ms || (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : 0),
  );

  const msToBeat = buildMsToBeat(input.tempos);
  const beatPosFn = buildMeasureFn(input.timeSignatures, msToBeat);
  const songEndMs = Math.max(...expRows.map(r => r.ms));
  const sectionFn = buildSectionFn(input.sections, songEndMs);

  const expMsUnique = [...new Set(expRows.map(r => r.ms))].sort(
    (a, b) => a - b,
  );
  const densityWindow = (ms: number): number => {
    const lo = bisectLeft(expMsUnique, ms - DENSITY_HALF_WINDOW_MS);
    const hi = bisectRight(expMsUnique, ms + DENSITY_HALF_WINDOW_MS);
    return hi - lo - 1; // exclude self tick
  };
  const prevMs = new Map<number, number>();
  const nextMs = new Map<number, number>();
  for (let i = 0; i < expMsUnique.length; i++) {
    const ms = expMsUnique[i];
    prevMs.set(ms, i > 0 ? expMsUnique[i - 1] : ms);
    nextMs.set(ms, i + 1 < expMsUnique.length ? expMsUnique[i + 1] : ms);
  }

  // chord_has: EPS_MS-quantized tick -> set of Expert lanes present there.
  const tickExpertLanes = new Map<number, Set<string>>();
  for (const r of expRows) {
    const t = pythonRound(r.ms / EPS_MS);
    let set = tickExpertLanes.get(t);
    if (!set) {
      set = new Set();
      tickExpertLanes.set(t, set);
    }
    set.add(r.lane);
  }

  // --- AUG_FEATS v7 per-song precomputation (annotate_features) ---
  const backboneMs = expRows
    .filter(r => BACKBONE_LANES.has(r.lane))
    .map(r => r.ms)
    .sort((a, b) => a - b);
  const byLaneMs = new Map<string, number[]>();
  for (const r of expRows) {
    const arr = byLaneMs.get(r.lane);
    if (arr) arr.push(r.ms);
    else byLaneMs.set(r.lane, [r.ms]);
  }
  for (const arr of byLaneMs.values()) arr.sort((a, b) => a - b);
  const tickRows = new Map<number, FlatRow[]>();
  for (const r of expRows) {
    const t = pythonRound(r.ms / EPS_MS);
    const arr = tickRows.get(t);
    if (arr) arr.push(r);
    else tickRows.set(t, [r]);
  }
  const densMedian = median(expRows.map(r => densityWindow(r.ms)));
  // `expRows` is already ms-ascending (primary sort key) — same as Python's
  // `sorted(r["ms"] for r in rows)`, a per-NOTE (not per-unique-tick) array.
  const allMsAllRows = expRows.map(r => r.ms);

  return expRows.map(r => {
    const beat = msToBeat(r.ms);
    const [beatInMeasure, beatsPerMeasure] = beatPosFn(beat);
    const [secType] = sectionFn(r.ms);
    const aligned = alignFlags(beatInMeasure);
    const chordHas =
      tickExpertLanes.get(pythonRound(r.ms / EPS_MS)) ?? new Set();
    const localDensity = densityWindow(r.ms);

    // aug_dist_backbone_ms: nearest kick/snare note distance.
    let augDistBackboneMs = AUG_GAP_CLAMP_MS;
    if (backboneMs.length > 0) {
      const i = bisectLeft(backboneMs, r.ms);
      const cands: number[] = [];
      if (i < backboneMs.length) cands.push(Math.abs(backboneMs[i] - r.ms));
      if (i > 0) cands.push(Math.abs(r.ms - backboneMs[i - 1]));
      augDistBackboneMs = cands.length ? Math.min(...cands) : AUG_GAP_CLAMP_MS;
    }

    // aug_samelane_{prev,next}_ms: same-lane neighbor gap.
    const laneMs = byLaneMs.get(r.lane) ?? [];
    const j = bisectLeft(laneMs, r.ms);
    const augSamelanePrevMs =
      j > 0
        ? Math.min(r.ms - laneMs[j - 1], AUG_GAP_CLAMP_MS)
        : AUG_GAP_CLAMP_MS;
    const augSamelaneNextMs =
      j + 1 < laneMs.length
        ? Math.min(laneMs[j + 1] - r.ms, AUG_GAP_CLAMP_MS)
        : AUG_GAP_CLAMP_MS;

    // aug_chord_priority: count of same-tick rows strictly more important.
    const tick = pythonRound(r.ms / EPS_MS);
    const myPriority = lanePriority(r.lane);
    let augChordPriority = 0;
    for (const o of tickRows.get(tick) ?? []) {
      if (lanePriority(o.lane) < myPriority) augChordPriority++;
    }

    // aug_density_{100,1500}ms: multi-scale note density (per NOTE, not
    // per-unique-tick — unlike local_density_500ms).
    const augDensity100ms =
      bisectRight(allMsAllRows, r.ms + AUG_DENSITY_100_HALF_MS) -
      bisectLeft(allMsAllRows, r.ms - AUG_DENSITY_100_HALF_MS) -
      1;
    const augDensity1500ms =
      bisectRight(allMsAllRows, r.ms + AUG_DENSITY_1500_HALF_MS) -
      bisectLeft(allMsAllRows, r.ms - AUG_DENSITY_1500_HALF_MS) -
      1;

    // aug_beat_frac: off-beatness (distance in beats from nearest integer beat).
    const augBeatFrac = Math.abs(beatInMeasure - pythonRound(beatInMeasure));

    // aug_lane_frac_500ms: fraction of +/-500ms-window notes sharing this lane.
    const lo5 = bisectLeft(allMsAllRows, r.ms - AUG_LANE_FRAC_HALF_MS);
    const hi5 = bisectRight(allMsAllRows, r.ms + AUG_LANE_FRAC_HALF_MS);
    const nWin = hi5 - lo5;
    const laneMsWin =
      bisectRight(laneMs, r.ms + AUG_LANE_FRAC_HALF_MS) -
      bisectLeft(laneMs, r.ms - AUG_LANE_FRAC_HALF_MS);
    const augLaneFrac500ms = nWin > 0 ? laneMsWin / nWin : 0.0;

    const numeric: Record<string, number> = {
      chord_size: r.chordSize,
      beat_in_measure: beatInMeasure,
      beats_per_measure: beatsPerMeasure,
      is_downbeat: beatInMeasure < ALIGN_EPS_BEATS ? 1 : 0,
      local_density_500ms: localDensity,
      gap_prev_ms: Math.min(r.ms - prevMs.get(r.ms)!, GAP_CLAMP_MS),
      gap_next_ms: Math.min(nextMs.get(r.ms)! - r.ms, GAP_CLAMP_MS),
      ghost: r.ghost ? 1 : 0,
      accent: r.accent ? 1 : 0,
      flam: r.flam ? 1 : 0,
      ...aligned,
      aug_dist_backbone_ms: augDistBackboneMs,
      aug_density_ratio: localDensity / (densMedian + 1.0),
      aug_samelane_prev_ms: augSamelanePrevMs,
      aug_samelane_next_ms: augSamelaneNextMs,
      aug_chord_priority: augChordPriority,
      aug_density_100ms: augDensity100ms,
      aug_density_1500ms: augDensity1500ms,
      aug_beat_frac: augBeatFrac,
      aug_lane_frac_500ms: augLaneFrac500ms,
    };

    const features = FEATURE_NAMES.map(name => {
      if (name in numeric) return numeric[name];
      if (name.startsWith('lane_')) return r.lane === name.slice(5) ? 1 : 0;
      if (name.startsWith('section_')) return secType === name.slice(8) ? 1 : 0;
      if (name.startsWith('era_')) return name.slice(4) === FIXED_ERA ? 1 : 0;
      if (name.startsWith('chord_has_'))
        return chordHas.has(name.slice(10)) ? 1 : 0;
      throw new Error(`unmapped feature ${name}`);
    });

    return {
      tick: r.tick,
      ms: r.ms,
      lane: r.lane,
      family: familyOfLane(r.lane),
      features,
    };
  });
}

// ---------------------------------------------------------------------------
// Build the featurizer input from the shared IR + ParsedChart timing
// ---------------------------------------------------------------------------

/**
 * Assemble {@link OursSongInput} from the adapter's {@link RawDrumChart}
 * (resolved lanes, ghost/accent/flam flags, note ms) plus the source
 * {@link ParsedChart}'s tempo/time-signature/section ms (scan-chart's own
 * tempo mapping — identical to what the Python featurizer consumed). All Expert
 * notes are kept, including double-kick, matching the Python featurizer (Onyx's
 * double-kick drop is an Onyx-only pitch-reader quirk, not Ours').
 */
export function buildOursInput(
  rawChart: RawDrumChart,
  parsedChart: ParsedChart,
): OursSongInput {
  const notes: OursNoteInput[] = rawChart.notes.map(n => ({
    tick: n.tick,
    ms: n.msTime,
    lane: n.lane,
    ghost: (n.flags & noteFlags.ghost) !== 0,
    accent: (n.flags & noteFlags.accent) !== 0,
    flam: (n.flags & noteFlags.flam) !== 0,
  }));
  return {
    notes,
    tempos: parsedChart.tempos.map(t => ({
      ms: t.msTime,
      bpm: t.beatsPerMinute,
    })),
    timeSignatures: parsedChart.timeSignatures.map(ts => ({
      ms: ts.msTime,
      numerator: ts.numerator,
      denominator: ts.denominator,
    })),
    sections: parsedChart.sections.map(s => ({ms: s.msTime, name: s.name})),
    resolution: parsedChart.resolution,
  };
}
