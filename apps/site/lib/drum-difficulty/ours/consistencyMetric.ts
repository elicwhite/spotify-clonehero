/**
 * Canonicalization pass — a faithful TS port of
 * `~/projects/drum-to-chart/analysis/hopcat_reduction_eval/consistency_metric.py`
 * (new in v3/"rb4_best"; v2 had no such step). Forces every instance of a
 * repeated Expert-chart groove (same notes, modulo tempo/measure position) to
 * reduce identically, using the reducer's OWN modal (majority-vote) reduction
 * for that groove — not an oracle/GT-informed choice. Pure: none of these
 * functions mutate their inputs.
 *
 * `buildMeasureClock`'s `BOUNDARY_EPS_BEATS` guard and `GROOVE_TPQ` bucketing
 * are load-bearing, not incidental: without them, floating-point drift from
 * summing many tempo-segment deltas can make an otherwise-exact repeat land
 * on different measure/tick buckets instance to instance, silently breaking
 * canonicalization on real (rubato/many-tempo-event) charts. See the
 * Python's 2026-07-21 catch this guards against.
 */

import {bisectRight, pythonRound} from './numeric';

/** Ticks-in-measure bucketing resolution (RB convention) — also the
 * grouping-key resolution `reduce.ts`'s groove-pooling steps use, so it's
 * exported rather than kept module-private. */
export const GROOVE_TPQ = 480;
const BOUNDARY_EPS_BEATS = 1e-6;

export interface ConsistencyNote {
  ms: number;
  lane: string;
}

export interface MeasureClock {
  /** `ms -> [measureIdx, beatInMeasure]`. */
  msToMeasure(ms: number): [number, number];
  /** `(measureIdx, beatInMeasure) -> ms` — the exact inverse, used to
   * re-render a donor measure's groove at a different measure's timing. */
  measureToMs(measureIdx: number, beatInMeasure: number): number;
}

/** `consistency_metric.build_measure_clock`. */
export function buildMeasureClock(
  tempos: {ms: number; bpm: number}[],
  timeSignatures: {ms: number; numerator: number; denominator: number}[],
): MeasureClock {
  let t = tempos.slice().sort((a, b) => a.ms - b.ms);
  if (t.length === 0 || t[0].ms > 0) {
    t = [{ms: 0, bpm: t.length ? t[0].bpm : 120.0}, ...t];
  }
  const anchorsMs: number[] = [];
  const anchorsBeat: number[] = [];
  const bpms: number[] = [];
  let cumBeats = 0.0;
  for (let i = 0; i < t.length; i++) {
    anchorsMs.push(t[i].ms);
    anchorsBeat.push(cumBeats);
    bpms.push(t[i].bpm);
    if (i + 1 < t.length) {
      cumBeats += ((t[i + 1].ms - t[i].ms) * t[i].bpm) / 60000.0;
    }
  }

  const msToBeat = (ms: number): number => {
    let idx = bisectRight(anchorsMs, ms) - 1;
    if (idx < 0) idx = 0;
    return anchorsBeat[idx] + ((ms - anchorsMs[idx]) * bpms[idx]) / 60000.0;
  };
  const beatToMs = (beat: number): number => {
    let idx = bisectRight(anchorsBeat, beat) - 1;
    if (idx < 0) idx = 0;
    return anchorsMs[idx] + ((beat - anchorsBeat[idx]) * 60000.0) / bpms[idx];
  };

  let ts = timeSignatures.slice().sort((a, b) => a.ms - b.ms);
  if (ts.length === 0) ts = [{ms: 0, numerator: 4, denominator: 4}];
  const segs: [number, number][] = ts.map(x => [
    msToBeat(x.ms),
    (x.numerator * 4.0) / x.denominator,
  ]);
  const segStarts = segs.map(s => s[0]);
  const cumMeasures: number[] = [0];
  for (let i = 1; i < segs.length; i++) {
    const [prevStart, prevBpMeasure] = segs[i - 1];
    const n =
      prevBpMeasure > 0
        ? pythonRound((segs[i][0] - prevStart) / prevBpMeasure)
        : 0;
    cumMeasures.push(cumMeasures[cumMeasures.length - 1] + Math.max(0, n));
  }

  const msToMeasure = (ms: number): [number, number] => {
    const beat = msToBeat(ms);
    let idx = bisectRight(segStarts, beat) - 1;
    if (idx < 0) idx = 0;
    const [segStart, bpMeasure] = segs[idx];
    const rel = beat - segStart;
    let nInSeg = bpMeasure > 0 ? Math.floor(rel / bpMeasure) : 0;
    let beatInMeasure = bpMeasure > 0 ? rel - nInSeg * bpMeasure : 0.0;
    if (bpMeasure > 0 && beatInMeasure > bpMeasure - BOUNDARY_EPS_BEATS) {
      nInSeg += 1;
      beatInMeasure = 0.0;
    }
    return [cumMeasures[idx] + nInSeg, beatInMeasure];
  };

  const measureToMs = (measureIdx: number, beatInMeasure: number): number => {
    let idx = bisectRight(cumMeasures, measureIdx) - 1;
    if (idx < 0) idx = 0;
    const [segStart, bpMeasure] = segs[idx];
    const nInSeg = measureIdx - cumMeasures[idx];
    return beatToMs(segStart + nInSeg * bpMeasure + beatInMeasure);
  };

  return {msToMeasure, measureToMs};
}

/** One measure's groove: `(tickInMeasure, lane)` pairs, deduped. */
export type Groove = ReadonlySet<string>;

function grooveKey(tickInMeasure: number, lane: string): string {
  return `${tickInMeasure}|${lane}`;
}

/** `consistency_metric.reduced_groove_by_measure`. */
export function reducedGrooveByMeasure(
  notes: readonly ConsistencyNote[],
  msToMeasure: (ms: number) => [number, number],
): Map<number, Groove> {
  const byMeasure = new Map<number, Set<string>>();
  for (const n of notes) {
    const [mi, beat] = msToMeasure(n.ms);
    let s = byMeasure.get(mi);
    if (!s) {
      s = new Set();
      byMeasure.set(mi, s);
    }
    s.add(grooveKey(pythonRound(beat * GROOVE_TPQ), n.lane));
  }
  return byMeasure;
}

/** Canonical, order-independent key for a {@link Groove} (frozenset
 * equality stand-in — two grooves are "the same" iff this key matches). */
function grooveSetKey(g: Groove): string {
  return [...g].sort().join(',');
}

export interface GrooveClusters {
  /** groove-set-key -> ascending measure indices (>= 2 members only). */
  clusters: Map<string, number[]>;
  nNonemptyMeasures: number;
}

/** `consistency_metric.expert_groove_clusters`. */
export function expertGrooveClusters(
  expertNotes: readonly ConsistencyNote[],
  msToMeasure: (ms: number) => [number, number],
): GrooveClusters {
  const rbm = reducedGrooveByMeasure(expertNotes, msToMeasure);
  const byGroove = new Map<string, number[]>();
  const measureIdxs = [...rbm.keys()].sort((a, b) => a - b);
  for (const mi of measureIdxs) {
    const key = grooveSetKey(rbm.get(mi)!);
    const arr = byGroove.get(key);
    if (arr) arr.push(mi);
    else byGroove.set(key, [mi]);
  }
  const clusters = new Map<string, number[]>();
  for (const [key, idxs] of byGroove) {
    if (idxs.length >= 2) clusters.set(key, idxs);
  }
  return {clusters, nNonemptyMeasures: rbm.size};
}

/** Majority vote, deterministic ties: JS `Map` insertion order matches
 * Python `Counter.most_common` for ties encountered in the same order
 * (`measureIdxs` is itself ascending — see {@link expertGrooveClusters}). */
function modalReduction(reductions: readonly Groove[]): Groove {
  const counts = new Map<string, {groove: Groove; n: number}>();
  for (const g of reductions) {
    const key = grooveSetKey(g);
    const entry = counts.get(key);
    if (entry) entry.n++;
    else counts.set(key, {groove: g, n: 1});
  }
  let best: {groove: Groove; n: number} | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  return best!.groove;
}

const EMPTY_GROOVE: Groove = new Set();

/**
 * The fix: force every instance in a repeated-groove cluster to the
 * reducer's OWN modal reduction for that groove. Non-clustered measures
 * (unique or empty Expert groove) pass through untouched. Returns a new,
 * ms-sorted note list — does not mutate `candNotes`/`clusters`/
 * `reducedByMeasure`. `consistency_metric.canonicalize`.
 */
export function canonicalize(
  candNotes: readonly ConsistencyNote[],
  clusters: Map<string, number[]>,
  reducedByMeasure: Map<number, Groove>,
  msToMeasure: (ms: number) => [number, number],
  measureToMs: (measureIdx: number, beatInMeasure: number) => number,
): ConsistencyNote[] {
  const clusteredMeasures = new Set<number>();
  for (const idxs of clusters.values())
    for (const mi of idxs) clusteredMeasures.add(mi);

  const out: ConsistencyNote[] = candNotes.filter(
    n => !clusteredMeasures.has(msToMeasure(n.ms)[0]),
  );

  for (const measureIdxs of clusters.values()) {
    const reductions = measureIdxs.map(
      mi => reducedByMeasure.get(mi) ?? EMPTY_GROOVE,
    );
    const modal = modalReduction(reductions);
    for (const mi of measureIdxs) {
      for (const pair of modal) {
        const sep = pair.indexOf('|');
        const tick = Number(pair.slice(0, sep));
        const lane = pair.slice(sep + 1);
        out.push({ms: measureToMs(mi, tick / GROOVE_TPQ), lane});
      }
    }
  }

  out.sort(
    (a, b) => a.ms - b.ms || (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : 0),
  );
  return out;
}
