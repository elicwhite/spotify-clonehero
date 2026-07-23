/**
 * "Ours" v5 ("591ab4a" packed) per-tier orchestrator — the survive ->
 * survive-pool -> threshold -> family-NMS -> relane -> relane-pool ->
 * chord-merge-dedup -> canonicalize decode from `manifest.json`'s
 * `decode.order`, ported from `export_model_591ab4a.json_reduce_song` /
 * `train_pinned_591ab4a.{apply_family_nms,cand_from_predictions,
 * groove_pool_proba,groove_pool_lane}`.
 *
 * This decode pipeline is UNCHANGED from v4 — v5 only replaced `model.ts`'s
 * artifact format (a packed binary tree encoding instead of a JSON dump, see
 * `model.ts`'s doc comment); every step below still applies verbatim. v4
 * introduced two new GROOVE-POOLING decode steps vs v3 ("rb4_best"), both
 * keyed off the same repeated-Expert-groove
 * clusters canonicalization uses (`consistencyMetric.ts`), and a reordering:
 * FAMILY-NMS now runs BEFORE relane predict (v3 had it after). Per tier:
 *   1. Survive head computes a raw `sigmoid(raw)` probability per note.
 *   2. SURVIVE-POOL (new vs v3): for notes in a repeated-groove measure,
 *      replace each note's probability with the MEAN probability across
 *      every instance of its `(groove, tickInMeasure, lane)` — a free
 *      variance reduction that makes repeats agree more often pre-canon.
 *      Notes in a non-repeated (or empty) measure are unpooled.
 *   3. Threshold the POOLED probability (`>= threshold`) to decide survival.
 *   4. FAMILY-NMS: among still-surviving cymbal/tom notes, greedy non-max-
 *      suppression by (pooled) survive probability — drop any other
 *      surviving family note within `familyNmsGapsMs[tier]` of an
 *      already-kept one (cross-family; backbone/other never suppressed).
 *      Runs BEFORE relane in v4 (only post-NMS survivors get relaned) —
 *      the reverse of v3's order.
 *   5. Kept notes whose original lane is in a family (cymbal/tom) get relaned
 *      by that family's head; kick/snare/other keep their lane, confidence 1.
 *   6. RELANE-POOL (new vs v3): for every family note in a repeated-groove
 *      measure (survived or not — the vote still counts, matching the
 *      Python), override its relaned lane with the CONFIDENCE-WEIGHTED MODAL
 *      lane across all instances of its `(groove, tickInMeasure,
 *      sourceLane)` — the group's relane confidences are summed per
 *      candidate lane and the highest-summed lane wins (not a plain
 *      majority vote).
 *   7. Surviving family notes are grouped by (ms, family, pooled final lane);
 *      a group with >1 member keeps only its highest-relane-confidence note.
 *      Non-family survivors are never deduped.
 *   8. CANONICALIZATION (unchanged from v3): force every instance of a
 *      repeated Expert-chart groove to reduce identically. Pooling already
 *      does most of this work upstream (pre-canon inconsistency dropped from
 *      0.066 in v3 to 0.0036 in v4), but pooling groups by `(groove, tick)`
 *      not full-groove identity, so a residual disagreement across whole
 *      instances is still possible — canonicalize still guarantees zero.
 *
 * Every tie-break below (NMS ordering, relane-pool's modal vote, chord-merge
 * dedup, canonicalize's modal reduction) is a straight port of what
 * `train_pinned_591ab4a.py`/`consistency_metric.py` ACTUALLY do — Python
 * stable-sort / dict-insertion-order / `Counter.most_common` ties, all of
 * which resolve to "first-encountered in row order", not a canonical
 * `lane_index`. The unrelated `drum-reducer-reference` project (a from-
 * scratch reimplementation of the same trained trees, see `model.ts`'s doc
 * comment) documents a DIFFERENT, more rigorously-specified tie-break
 * convention in its own `DETERMINISM_CONTRACT.md` (`(-score, ms, lane_index)`
 * etc.) — that spec does NOT describe this deployed model's actual decode
 * script, confirmed by testing: swapping to it regressed 2 of the 20 real
 * fixtures. Do not "fix" these tie-breaks to match that other project's
 * convention; the ground truth here is `train_pinned_591ab4a`'s own
 * behavior, not a differently-designed reference implementation's.
 */

import type {DrumLane, RawDrumChart} from '../types';
import type {ParsedChart} from '../../preview/chorus-chart-processing';
import {
  buildMeasureClock,
  canonicalize,
  expertGrooveClusters,
  GROOVE_TPQ,
  reducedGrooveByMeasure,
  type ConsistencyNote,
} from './consistencyMetric';
import {
  buildMsToBeat,
  buildOursInput,
  familyOfLane,
  featurizeSong,
  type Family,
  type FeatureRow,
  type OursSongInput,
} from './featurize';
import {pythonRound} from './numeric';
import {
  loadOursModels,
  relanePredict,
  surviveProba,
  type OursModels,
  type RelaneModel,
  type SurviveModel,
  type Tier,
} from './model';

/** One surviving reduced note. `lane` is the final (possibly relaned) lane. */
export interface OursOutNote {
  tick: number;
  msTime: number;
  lane: string;
  originalLane: string;
  family: Family;
  relaned: boolean;
  confidence: number;
}

export interface OursTiers<T> {
  hard: T;
  medium: T;
  easy: T;
}

interface RelaneHeads {
  cymbal: RelaneModel;
  tom: RelaneModel;
}

/** `measureIdx -> grooveKey` reverse lookup from an `expertGrooveClusters`
 * result — shared by both pooling steps. `train_pinned_591ab4a`'s
 * `meas_to_groove`, built inline in both `groove_pool_proba`/`_lane`. */
function measureToGroove(clusters: Map<string, number[]>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [groove, idxs] of clusters) {
    for (const mi of idxs) out.set(mi, groove);
  }
  return out;
}

/**
 * SURVIVE-POOL: replace each note's survive probability with the MEAN
 * probability across every instance of its `(groove, tickInMeasure, lane)`
 * — computed BEFORE thresholding. Notes whose measure isn't in any repeated-
 * groove cluster are returned unchanged. `train_pinned_591ab4a.groove_pool_proba`.
 */
function groovePoolProba(
  rows: readonly FeatureRow[],
  sp: readonly number[],
  msToMeasure: (ms: number) => [number, number],
  clusters: Map<string, number[]>,
): number[] {
  if (clusters.size === 0) return sp.slice();
  const measToGroove = measureToGroove(clusters);

  const keyed = new Array<string | null>(rows.length);
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const [mi, beat] = msToMeasure(rows[i].ms);
    const groove = measToGroove.get(mi);
    if (groove === undefined) {
      keyed[i] = null;
      continue;
    }
    const key = `${groove}|${pythonRound(beat * GROOVE_TPQ)}|${rows[i].lane}`;
    keyed[i] = key;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(sp[i]);
    else buckets.set(key, [sp[i]]);
  }
  if (buckets.size === 0) return sp.slice();

  const means = new Map<string, number>();
  for (const [key, vals] of buckets) {
    means.set(key, vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  const out = sp.slice();
  for (let i = 0; i < rows.length; i++) {
    const key = keyed[i];
    if (key !== null) out[i] = means.get(key)!;
  }
  return out;
}

/**
 * RELANE-POOL: for FAMILY notes in a repeated-groove measure, override the
 * relaned `finalLane` with the CONFIDENCE-WEIGHTED MODAL lane across every
 * instance of its `(groove, tickInMeasure, sourceLane)` — confidence is
 * summed per candidate lane across the whole group and the highest-summed
 * lane wins (ties keep the first-encountered — i.e. lowest row-index —
 * candidate, matching Python's `max(v.items(), key=...)` over dict-insertion
 * order, `groove_pool_lane`'s actual behavior). Every family row in a
 * cluster casts its vote regardless of survive status,
 * matching the Python (`groove_pool_lane` runs over the full `rows` array,
 * not just survivors) — a non-surviving note's default `own-lane, conf=1.0`
 * still weighs in on the group's modal decision for its surviving peers.
 * `train_pinned_591ab4a.groove_pool_lane`.
 */
function groovePoolLane(
  rows: readonly FeatureRow[],
  finalLane: readonly string[],
  confidence: readonly number[],
  msToMeasure: (ms: number) => [number, number],
  clusters: Map<string, number[]>,
): string[] {
  if (clusters.size === 0) return finalLane.slice();
  const measToGroove = measureToGroove(clusters);

  const keyed = new Array<string | null>(rows.length);
  const votes = new Map<string, Map<string, number>>();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].family === 'fixed') {
      keyed[i] = null;
      continue;
    }
    const [mi, beat] = msToMeasure(rows[i].ms);
    const groove = measToGroove.get(mi);
    if (groove === undefined) {
      keyed[i] = null;
      continue;
    }
    const key = `${groove}|${pythonRound(beat * GROOVE_TPQ)}|${rows[i].lane}`;
    keyed[i] = key;
    let tally = votes.get(key);
    if (!tally) {
      tally = new Map();
      votes.set(key, tally);
    }
    tally.set(finalLane[i], (tally.get(finalLane[i]) ?? 0) + confidence[i]);
  }
  if (votes.size === 0) return finalLane.slice();

  const modal = new Map<string, string>();
  for (const [key, tally] of votes) {
    let bestLane = '';
    let bestScore = -Infinity;
    for (const [lane, score] of tally) {
      if (score > bestScore) {
        bestScore = score;
        bestLane = lane;
      }
    }
    modal.set(key, bestLane);
  }
  const out = finalLane.slice();
  for (let i = 0; i < rows.length; i++) {
    const key = keyed[i];
    if (key !== null) out[i] = modal.get(key)!;
  }
  return out;
}

/** Reduce one tier's featurized rows through its survive + relane heads,
 * groove-pooling, family-NMS, and chord-merge dedup (everything except
 * canonicalization, which needs song-wide context — see {@link reduceOurs}).
 * `msToMeasure`/`clusters` are the same measure-clock + Expert-groove
 * clusters {@link reduceOurs} builds once per song for canonicalization. */
export function reduceOursTier(
  rows: FeatureRow[],
  survive: SurviveModel,
  relane: RelaneHeads,
  familyNmsGapMs: number | null,
  msToMeasure: (ms: number) => [number, number],
  clusters: Map<string, number[]>,
): OursOutNote[] {
  const rawProba = rows.map(r => surviveProba(survive, r.features));
  const sp = groovePoolProba(rows, rawProba, msToMeasure, clusters);
  const survived: boolean[] = sp.map(p => p >= survive.threshold);

  // FAMILY-NMS runs on the pooled+thresholded survive mask, BEFORE relane
  // predict (v4's order — v3 ran relane first). Greedy non-max-suppression
  // by (pooled) survive probability, highest first. `apply_family_nms`.
  if (familyNmsGapMs != null) {
    const famIdx: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (survived[i] && rows[i].family !== 'fixed') famIdx.push(i);
    }
    famIdx.sort((a, b) => sp[b] - sp[a]);
    const keptMs: number[] = [];
    for (const i of famIdx) {
      const ms = rows[i].ms;
      if (keptMs.some(km => Math.abs(ms - km) < familyNmsGapMs)) {
        survived[i] = false;
      } else {
        keptMs.push(ms);
      }
    }
  }

  const rawFinalLane: string[] = rows.map(r => r.lane);
  const confidence: number[] = rows.map(() => 1.0);
  for (const family of ['cymbal', 'tom'] as const) {
    const head = relane[family];
    for (let i = 0; i < rows.length; i++) {
      if (!survived[i] || rows[i].family !== family) continue;
      const {lane, confidence: conf} = relanePredict(head, rows[i].features);
      rawFinalLane[i] = lane;
      confidence[i] = conf;
    }
  }

  const finalLane = groovePoolLane(
    rows,
    rawFinalLane,
    confidence,
    msToMeasure,
    clusters,
  );

  // Chord-merge dedup over surviving FAMILY notes (post-NMS, post-pool):
  // group by (ms, family, final lane), keep the highest-confidence member.
  // Fixed (non-family) survivors pass through untouched.
  const fixedIdx: number[] = [];
  const groups = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    if (!survived[i]) continue;
    if (rows[i].family === 'fixed') {
      fixedIdx.push(i);
      continue;
    }
    const key = `${rows[i].ms}|${rows[i].family}|${finalLane[i]}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  }

  const out: OursOutNote[] = [];
  for (const i of fixedIdx) {
    out.push({
      tick: rows[i].tick,
      msTime: rows[i].ms,
      lane: rows[i].lane,
      originalLane: rows[i].lane,
      family: rows[i].family,
      relaned: false,
      confidence: 1.0,
    });
  }
  for (const group of groups.values()) {
    // Stable sort by descending confidence; ties keep insertion (row) order
    // (matching Python's stable `group.sort(key=lambda i: -conf[i])`).
    group.sort((a, b) => confidence[b] - confidence[a]);
    const i = group[0];
    out.push({
      tick: rows[i].tick,
      msTime: rows[i].ms,
      lane: finalLane[i],
      originalLane: rows[i].lane,
      family: rows[i].family,
      relaned: finalLane[i] !== rows[i].lane,
      confidence: confidence[i],
    });
  }

  out.sort((a, b) => a.tick - b.tick);
  return out;
}

/**
 * Canonicalize one tier's candidate notes against the song-wide Expert
 * groove clusters. Notes whose `(ms, lane)` survive unchanged (the common
 * case — most measures aren't in any repeated-groove cluster, and even a
 * clustered measure's own candidate often already matches the modal groove)
 * keep their original bookkeeping via an exact `(ms, lane)` key lookup;
 * donor-copied notes (a clustered measure whose instance disagreed with the
 * modal) get diagnostic-only bookkeeping synthesized, since canonicalize's
 * Python counterpart carries only `(ms, lane)` too — see
 * `consistency_metric.canonicalize`'s docstring.
 */
function applyCanonicalization(
  candidate: OursOutNote[],
  clusters: Map<string, number[]>,
  msToMeasure: (ms: number) => [number, number],
  measureToMs: (measureIdx: number, beatInMeasure: number) => number,
  msToBeat: (ms: number) => number,
  resolution: number,
): OursOutNote[] {
  if (clusters.size === 0) return candidate;

  const asConsistency: ConsistencyNote[] = candidate.map(n => ({
    ms: n.msTime,
    lane: n.lane,
  }));
  const rbmPre = reducedGrooveByMeasure(asConsistency, msToMeasure);
  const canon = canonicalize(
    asConsistency,
    clusters,
    rbmPre,
    msToMeasure,
    measureToMs,
  );

  const byKey = new Map<string, OursOutNote>();
  for (const n of candidate) byKey.set(`${n.msTime}|${n.lane}`, n);

  return canon.map(n => {
    const orig = byKey.get(`${n.ms}|${n.lane}`);
    if (orig) return orig;
    return {
      tick: pythonRound(msToBeat(n.ms) * resolution),
      msTime: n.ms,
      lane: n.lane,
      originalLane: n.lane,
      family: familyOfLane(n.lane),
      relaned: false,
      confidence: 1.0,
    };
  });
}

/** Featurize once, then reduce + canonicalize every tier. */
export function reduceOurs(
  input: OursSongInput,
  models: OursModels,
): OursTiers<OursOutNote[]> {
  const rows = featurizeSong(input);

  const {msToMeasure, measureToMs} = buildMeasureClock(
    input.tempos,
    input.timeSignatures,
  );
  const expertNotes: ConsistencyNote[] = rows.map(r => ({
    ms: r.ms,
    lane: r.lane,
  }));
  const {clusters} = expertGrooveClusters(expertNotes, msToMeasure);
  const msToBeat = buildMsToBeat(input.tempos);

  const forTier = (tier: Tier): OursOutNote[] => {
    const candidate = reduceOursTier(
      rows,
      models.survive[tier],
      models.relane[tier],
      models.familyNmsGapsMs[tier],
      msToMeasure,
      clusters,
    );
    return applyCanonicalization(
      candidate,
      clusters,
      msToMeasure,
      measureToMs,
      msToBeat,
      input.resolution,
    );
  };

  return {
    hard: forTier('hard'),
    medium: forTier('medium'),
    easy: forTier('easy'),
  };
}

/** Convenience: build the featurizer input from the adapter IR + ParsedChart,
 * then reduce. Models must be supplied (lazily fetched via
 * {@link loadOursModels} at the callsite). */
export function reduceOursFromChart(
  rawChart: RawDrumChart,
  parsedChart: ParsedChart,
  models: OursModels,
): OursTiers<OursOutNote[]> {
  return reduceOurs(buildOursInput(rawChart, parsedChart), models);
}

export {loadOursModels};
export type {DrumLane, OursModels, Tier};
