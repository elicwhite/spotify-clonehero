/**
 * KS-warp: kick+snare onset-anchored drift-warp grid lever.
 *
 * Port of `levers/kick_snare_warp.py` (drum-to-chart, analysis/product_pipeline,
 * commit history 8454617/f367eab/1e4b20a on the pipeline-loop branch; shipped
 * config per Eli's ruling "Ship drift 5", 2026-07-17) plus the `anchored_beats`
 * helper from `levers/rigid_collapse.py`.
 *
 * WHAT IT DOES. On near-constant-tempo songs where the predicted beat grid has
 * drifted from the true tempo (worst at sparse intros — the "Check Yes Juliet"
 * class), this lever detects the drift via a comb-fit to the app's own decoded
 * kick+snare onsets, and — only if a deployable gate admits — softly warps the
 * beat grid a fraction (lambda=0.5, NOT a hard snap; hard snap is
 * self-referential/circular and is explicitly banned by the Python reference)
 * toward those onsets, then rebuilds a per-beat tempo map. It is a byte-identical
 * no-op on any ungated song.
 *
 * INPUTS. Unlike the Python reference (which decodes kick+snare onsets itself
 * from raw CRNN probs via `SF.decode("raw", ...)`), the app already has decoded,
 * peak-picked, max-2-hands-limited `RawDrumEvent[]` (peak-picking.ts) by the time
 * chart-builder.ts runs — that IS the "raw" decode the Python module's own
 * docstring says the port surface should reuse, not re-derive. Callers must pass
 * RAW (uncorrected) onset times — i.e. `event.timeSeconds * 1000` — NOT the
 * SYSTEMATIC_ONSET_MS_AUDIO_FLOW-adjusted times used elsewhere in chart-builder,
 * to match `SF.decode("raw", ...)`'s uncorrected contract.
 *
 * DO NOT raise `lam` toward 1.0 — see the Python module's docstring for why
 * (note_ms becomes partly self-referential at any lam>0, and fully circular at
 * lam=1; the KEEP rests on GT-referenced metrics measured in the research loop,
 * not reproduced here).
 */

import type {Synctrack, TempoEvent} from './types';
import {buildTimedTempos, tickToMs} from '../drum-transcription/timing';
import type {TimedTempo} from '../drum-transcription/chart-types';

const RESOLUTION = 480;

// --- SOTA-style config (mirrors converter.ts's SOTA block) ---------------
export const KS_WARP_ENABLED = true;
export const KS_WARP_LAMBDA = 0.5;
export const KS_WARP_WIN_MS = 70.0;
export const KS_WARP_GATE_KS_P50_MAX_MS = 7.0;
export const KS_WARP_GATE_KS_INLF_MIN = 0.85;
export const KS_WARP_GATE_DRIFT_KS_MIN_MS = 5.0;
export const KS_WARP_GATE_RATIO_LO = 0.9;
export const KS_WARP_GATE_RATIO_HI = 1.1;

export interface KSWarpConfig {
  lam: number;
  winMs: number;
  gateKsP50MaxMs: number;
  gateKsInlfMin: number;
  gateDriftKsMinMs: number;
  ratioLo: number;
  ratioHi: number;
}

export const DEFAULT_KS_WARP_CONFIG: KSWarpConfig = {
  lam: KS_WARP_LAMBDA,
  winMs: KS_WARP_WIN_MS,
  gateKsP50MaxMs: KS_WARP_GATE_KS_P50_MAX_MS,
  gateKsInlfMin: KS_WARP_GATE_KS_INLF_MIN,
  gateDriftKsMinMs: KS_WARP_GATE_DRIFT_KS_MIN_MS,
  ratioLo: KS_WARP_GATE_RATIO_LO,
  ratioHi: KS_WARP_GATE_RATIO_HI,
};

export interface KSWarpDiag {
  reason?: string;
  ksP50?: number | null;
  ksInlf?: number | null;
  driftKs?: number | null;
  nKs?: number;
  admitted?: boolean;
}

// ---------------------------------------------------------------------------
// small numeric helpers (local copies — see converter.ts for the same
// conventions used elsewhere in this package)
// ---------------------------------------------------------------------------

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(sortedArr: number[], p: number): number {
  // numpy.percentile default (linear interpolation), input MUST be sorted ascending.
  if (sortedArr.length === 0) return NaN;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
}

function diffArr(arr: number[]): number[] {
  const out = new Array(Math.max(0, arr.length - 1));
  for (let i = 0; i < arr.length - 1; i++) out[i] = arr[i + 1] - arr[i];
  return out;
}

/** numpy.searchsorted(sortedArr, x) default side='left': first index i such
 * that sortedArr[i-1] < x <= sortedArr[i]. */
function searchsortedLeft(sortedArr: number[], x: number): number {
  let lo = 0,
    hi = sortedArr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sortedArr[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Vectorized numpy.searchsorted(sortedArr, xs) for each element of xs. */
function searchsortedLeftMany(sortedArr: number[], xs: number[]): number[] {
  return xs.map(x => searchsortedLeft(sortedArr, x));
}

/** Simple linear interpolation matching np.interp's INTERIOR behavior
 * (piecewise-linear between consecutive (xp[i], fp[i]) pairs, xp strictly
 * increasing). Callers here only ever query interior points AND immediately
 * overwrite exterior ones with their own extrapolation (matching the Python
 * reference, which calls np.interp then overrides both tails), so clamp
 * behavior for x outside [xp[0], xp[-1]] is irrelevant and not replicated. */
function linearInterpInterior(x: number, xp: number[], fp: number[]): number {
  if (x <= xp[0]) return fp[0];
  if (x >= xp[xp.length - 1]) return fp[fp.length - 1];
  // xp values here are integer beat indices (0..N-1), small arrays — linear
  // scan is fine and keeps this a direct, auditable port.
  let i = 0;
  while (i < xp.length - 1 && xp[i + 1] < x) i++;
  const x0 = xp[i],
    x1 = xp[i + 1];
  const y0 = fp[i],
    y1 = fp[i + 1];
  if (x1 === x0) return y0;
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

// ---------------------------------------------------------------------------
// timeToBeta: PORT of chart_eval.ms_to_betas / TP.time_to_beta (== the SAME
// piecewise-tempo beta map converter.ts's private `timeToBeta` implements —
// duplicated here in full rather than imported, since converter.ts doesn't
// export it and this is a small, auditable function to keep byte-identical).
//
// KEY SUBTLETY (found empirically debugging this port against a real fixture
// where grid.tempos[0].ms=1379.2 != grid.origin_ms=88.8 — NOT the invariant
// this module's earlier docstring assumed): `tempoArrays` FORCES segMs[0] to
// originMs regardless of tempos[0].ms, so segment 0 always spans
// [originMs, tempos[1].ms) at tempos[0].bpm. A tempo event's own beta is
// therefore NOT simply a cumulative sum of consecutive (tempos[i], tempos[i-1])
// gaps when tempos[0].ms != originMs — it must go through this full
// segment-search evaluated against the grid's own origin-anchored schedule,
// exactly like `emit_tempos_from_gt_grid`'s injected `ms_to_betas` does.
// ---------------------------------------------------------------------------
function tempoArraysForBeta(
  tempos: TempoEvent[],
  originMs: number,
): {segMs: number[]; segBpm: number[]} {
  let ms = tempos.map(t => Math.max(t.ms, originMs));
  let bpm = tempos.map(t => t.bpm);
  const keep = [true];
  for (let i = 1; i < ms.length; i++) keep.push(ms[i] > ms[i - 1]);
  ms = ms.filter((_, i) => keep[i]);
  bpm = bpm.filter((_, i) => keep[i]);
  ms[0] = originMs;
  return {segMs: ms, segBpm: bpm};
}

function timeToBeta(
  tsMs: number,
  tempos: TempoEvent[],
  originMs: number,
): number {
  const {segMs, segBpm} = tempoArraysForBeta(tempos, originMs);
  const segDur = segBpm.map(b => 60_000.0 / b);
  const cum = [0.0];
  for (let i = 0; i < segMs.length - 1; i++) {
    cum.push(cum[i] + (segMs[i + 1] - segMs[i]) / segDur[i]);
  }
  // searchsorted(segMs, x, side='right') - 1
  let idx = 0;
  while (idx < segMs.length && segMs[idx] <= tsMs) idx++;
  idx = Math.max(0, Math.min(segMs.length - 1, idx - 1));
  return cum[idx] + (tsMs - segMs[idx]) / segDur[idx];
}

// ---------------------------------------------------------------------------
// anchoredBeats: port of rigid_collapse.anchored_beats
// (+ emit_tempos_from_gt_grid, whose injected ms_to_betas is chart_eval's
// ms_to_betas == the timeToBeta above).
//
// For each grid.tempos[i], its tick is timeToBeta(tempos[i].ms, tempos, origin)
// * RESOLUTION — the grid's OWN origin-anchored piecewise schedule, matching
// emit_tempos_from_gt_grid exactly (including its sort-by-tick and its
// tick=0-prepend-if-missing fix, both replicated below). Feeding that into
// buildTimedTempos + tickToMs reproduces anchored_beats: beats[0] === origin_ms
// by construction (the prepend guarantees a tick=0 anchor at origin's bpm).
// ---------------------------------------------------------------------------
export function anchoredBeats(
  grid: Synctrack,
  maxMs = 240000.0,
  maxB = 4000,
): {beats: number[]; origin: number} {
  const origin = grid.origin_ms;
  const tempos = grid.tempos;

  let emit: {tick: number; beatsPerMinute: number}[];
  if (tempos.length === 0) {
    emit = [{tick: 0, beatsPerMinute: 120.0}];
  } else {
    emit = tempos
      .map(t => ({
        tick: timeToBeta(t.ms, tempos, origin) * RESOLUTION,
        beatsPerMinute: t.bpm,
      }))
      .sort((a, b) => a.tick - b.tick);
    if (emit[0].tick !== 0.0) {
      emit = [{tick: 0, beatsPerMinute: emit[0].beatsPerMinute}, ...emit];
    }
  }

  const timed: TimedTempo[] = buildTimedTempos(emit, RESOLUTION);

  const beats: number[] = [];
  let b = 0;
  while (b < maxB) {
    const t = origin + tickToMs(b * RESOLUTION, timed, RESOLUTION);
    beats.push(t);
    b += 1;
    if (beats.length > 3 && t - origin > maxMs) break;
  }
  return {beats, origin};
}

// ---------------------------------------------------------------------------
// Gate signals (deployable; onset/audio evidence only).
// ---------------------------------------------------------------------------

interface CombFit {
  bpm: number;
  p16: number;
  phase: number;
  p50: number;
  p90: number;
  ratio: number;
  inlf: number;
}

/** Port of kick_snare_warp._comb_fit. */
function combFit(onsetsIn: number[], bpm0: number): CombFit | null {
  const onsets = Array.from(onsetsIn).sort((a, b) => a - b);
  let best: CombFit | null = null;
  const base = bpm0;
  const N_F = 49;
  for (let fi = 0; fi < N_F; fi++) {
    const f = -0.06 + (0.12 * fi) / (N_F - 1); // np.linspace(-0.06, 0.06, 49)
    const bpm = base * (1 + f);
    let p16 = 60000.0 / bpm / 4.0;

    // coarse phase scan: 72 candidate phases in [0, p16)
    const N_PH = 72;
    let bestPhase = 0;
    let bestMedD = Infinity;
    for (let pi = 0; pi < N_PH; pi++) {
      const phase = (p16 * pi) / N_PH;
      const dists: number[] = onsets.map(o => {
        const r = ((o % p16) + p16) % p16;
        const dd = Math.abs(r - phase);
        return Math.min(dd, p16 - dd);
      });
      const medD = median(dists);
      if (medD < bestMedD) {
        bestMedD = medD;
        bestPhase = phase;
      }
    }
    let phase = bestPhase;

    for (let iter = 0; iter < 6; iter++) {
      const n = onsets.map(o => Math.round((o - phase) / p16));
      const inlierIdx: number[] = [];
      for (let i = 0; i < onsets.length; i++) {
        if (Math.abs(onsets[i] - (phase + n[i] * p16)) < 30.0)
          inlierIdx.push(i);
      }
      if (inlierIdx.length < 8) break;
      // Linear LSQ: onsets[inl] = a*n[inl] + b
      let sx = 0,
        sy = 0,
        sxx = 0,
        sxy = 0;
      const m = inlierIdx.length;
      for (const i of inlierIdx) {
        sx += n[i];
        sy += onsets[i];
        sxx += n[i] * n[i];
        sxy += n[i] * onsets[i];
      }
      const denom = m * sxx - sx * sx;
      const a = denom !== 0 ? (m * sxy - sx * sy) / denom : 0;
      const b = (sy - a * sx) / m;
      if (a <= 0) break;
      p16 = a;
      phase = b;
    }

    const n = onsets.map(o => Math.round((o - phase) / p16));
    const dist = onsets.map((o, i) => Math.abs(o - (phase + n[i] * p16)));
    const inlierIdx: number[] = [];
    for (let i = 0; i < dist.length; i++) if (dist[i] < 30.0) inlierIdx.push(i);
    if (inlierIdx.length < 8) continue;
    const inlierDist = inlierIdx.map(i => dist[i]).sort((a, b) => a - b);
    const med = median(inlierDist);
    if (best === null || med < best.p50) {
      const fbpm = 60000.0 / (p16 * 4.0);
      best = {
        bpm: fbpm,
        p16,
        phase,
        p50: med,
        p90: percentile(inlierDist, 90),
        ratio: fbpm / bpm0,
        inlf: inlierIdx.length / onsets.length,
      };
    }
  }
  return best;
}

/** Port of kick_snare_warp.drift_vs_ks. */
function driftVsKs(beats: number[], ks: number[] | null): number | null {
  if (ks === null || ks.length < 8 || beats.length < 8) return null;
  const gi = searchsortedLeftMany(ks, beats);
  const d: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const cc: number[] = [];
    if (gi[i] < ks.length) cc.push(ks[gi[i]] - beats[i]);
    if (gi[i] > 0) cc.push(ks[gi[i] - 1] - beats[i]);
    if (cc.length) {
      cc.sort((a, b) => Math.abs(a) - Math.abs(b));
      d.push(cc[0]);
    }
  }
  if (d.length < 8) return null;
  const med = median(d);
  const absDevs = d.map(x => Math.abs(x - med));
  return median(absDevs);
}

function admits(
  ksComb: CombFit | null,
  driftKs: number | null,
  cfg: KSWarpConfig,
): boolean {
  if (ksComb === null || driftKs === null) return false;
  return (
    ksComb.p50 <= cfg.gateKsP50MaxMs &&
    ksComb.inlf >= cfg.gateKsInlfMin &&
    cfg.ratioLo <= ksComb.ratio &&
    ksComb.ratio <= cfg.ratioHi &&
    driftKs >= cfg.gateDriftKsMinMs
  );
}

// ---------------------------------------------------------------------------
// Warp: port of kick_snare_warp._warp_beats.
// ---------------------------------------------------------------------------
function warpBeats(
  beats: number[],
  targets: number[],
  win: number,
  lam: number,
): number[] | null {
  const salOn = Array.from(targets).sort((a, b) => a - b);
  if (salOn.length < 4) return null;

  const gi = searchsortedLeftMany(salOn, beats);
  const ai: number[] = [];
  const ap: number[] = [];
  for (let bi = 0; bi < beats.length; bi++) {
    const cc: number[] = [];
    if (gi[bi] < salOn.length) cc.push(salOn[gi[bi]]);
    if (gi[bi] > 0) cc.push(salOn[gi[bi] - 1]);
    if (cc.length) {
      cc.sort((a, b) => Math.abs(a - beats[bi]) - Math.abs(b - beats[bi]));
      const nn = cc[0];
      if (Math.abs(nn - beats[bi]) <= win) {
        ai.push(bi);
        ap.push(beats[bi] + lam * (nn - beats[bi]));
      }
    }
  }
  if (ai.length < 2) return null;

  const warped = new Array<number>(beats.length);
  for (let k = 0; k < beats.length; k++) {
    warped[k] = linearInterpInterior(k, ai, ap);
  }
  const s0 = (ap[1] - ap[0]) / (ai[1] - ai[0]);
  const sN = (ap[ap.length - 1] - ap[ap.length - 2]) /
    (ai[ai.length - 1] - ai[ai.length - 2]);
  for (let k = 0; k < beats.length; k++) {
    if (k < ai[0]) warped[k] = ap[0] - (ai[0] - k) * s0;
    else if (k > ai[ai.length - 1])
      warped[k] = ap[ap.length - 1] + (k - ai[ai.length - 1]) * sN;
  }
  // np.maximum.accumulate: running cumulative max.
  for (let k = 1; k < warped.length; k++) {
    if (warped[k] < warped[k - 1]) warped[k] = warped[k - 1];
  }
  return warped;
}

// ---------------------------------------------------------------------------
// Public entry: port of kick_snare_warp.warp_grid.
// ---------------------------------------------------------------------------

/**
 * Attempt to warp `synctrack` toward `ksOnsetsMs` (sorted or unsorted RAW
 * kick+snare onset times, ms). Returns the warped Synctrack, or `null` to
 * leave the incumbent grid unchanged (not gate-admitted, or warp not
 * constructible) — matching the Python reference's `(None, diag)` contract
 * (diag returned alongside for optional debug logging).
 */
export function warpGrid(
  synctrack: Synctrack,
  ksOnsetsMs: number[],
  cfg: KSWarpConfig = DEFAULT_KS_WARP_CONFIG,
): {grid: Synctrack | null; diag: KSWarpDiag} {
  const {beats} = anchoredBeats(synctrack);
  if (beats.length < 8) {
    return {grid: null, diag: {reason: 'too_few_beats'}};
  }
  const bpm0 = 60000.0 / median(diffArr(beats));

  const ks =
    ksOnsetsMs && ksOnsetsMs.length
      ? Array.from(ksOnsetsMs).sort((a, b) => a - b)
      : null;
  const ksComb = ks !== null && ks.length >= 8 ? combFit(ks, bpm0) : null;
  const dks = driftVsKs(beats, ks);

  const diag: KSWarpDiag = {
    ksP50: ksComb ? ksComb.p50 : null,
    ksInlf: ksComb ? ksComb.inlf : null,
    driftKs: dks,
    nKs: ks === null ? 0 : ks.length,
  };

  if (!admits(ksComb, dks, cfg)) {
    return {grid: null, diag: {...diag, admitted: false}};
  }

  const warped = warpBeats(beats, ks as number[], cfg.winMs, cfg.lam);
  if (warped === null) {
    return {
      grid: null,
      diag: {...diag, admitted: true, reason: 'warp_unconstructible'},
    };
  }

  const timeSignatures =
    synctrack.timeSignatures && synctrack.timeSignatures.length
      ? synctrack.timeSignatures
      : [{ms: warped[0], numerator: 4, denominator: 4}];

  const tempos: TempoEvent[] = [];
  for (let bi = 0; bi < warped.length - 1; bi++) {
    const dt = warped[bi + 1] - warped[bi];
    if (dt > 1.0 && 60000.0 / dt >= 30.0 && 60000.0 / dt <= 400.0) {
      tempos.push({ms: warped[bi], bpm: 60000.0 / dt});
    }
  }
  if (tempos.length < 2) {
    return {
      grid: null,
      diag: {...diag, admitted: true, reason: 'warp_unconstructible'},
    };
  }

  const grid: Synctrack = {
    origin_ms: warped[0],
    tempos,
    timeSignatures,
  };
  return {grid, diag: {...diag, admitted: true}};
}
