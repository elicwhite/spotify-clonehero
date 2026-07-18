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
import {buildTimedTempos, msToTick, tickToMs} from '../drum-transcription/timing';
import type {TimedTempo} from '../drum-transcription/chart-types';
import {snapGroupToGrid} from './quantize-grid';
import {DEFAULT_SNAP_TOLERANCE_MS} from './swap-synctrack';
import {SYSTEMATIC_ONSET_MS_AUDIO_FLOW} from '../drum-transcription/ml/types';
import {DEFAULT_PHASE_ALIGN_CONFIG} from '../drum-transcription/ml/phase-align-config';
import {
  computePhaseAlignShiftMs,
  MIN_ONSETS_FOR_SEARCH,
} from '../drum-transcription/pipeline/phase-align';

const RESOLUTION = 480;

// --- SOTA-style config (mirrors converter.ts's SOTA block) ---------------
export const KS_WARP_ENABLED = true;

/** Master flag for the SHIPPED reach-extension (windowed warp + note_ms
 * guard, see below) — when true (the shipped default), chart-builder.ts
 * routes through {@link warpGridReach} instead of the whole-song `warpGrid`
 * d5 lever, regardless of {@link KS_WARP_ENABLED}. Set false to fall back to
 * the d5 whole-song-gate path (still gated by KS_WARP_ENABLED). */
export const KS_WARP_REACH_ENABLED = true;
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
/**
 * The grid's own-origin-anchored timed-tempo schedule (tick=0 === origin_ms),
 * matching `emit_tempos_from_gt_grid` + `build_timed_tempos` in the Python
 * reference. Shared by {@link anchoredBeats} and the reach-extension's
 * post-snap note_ms guard ({@link postsnapNoteMedian}), which both need to
 * convert ms<->tick in this same origin-anchored frame.
 */
function buildOwnOriginTimedTempos(grid: Synctrack): TimedTempo[] {
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

  return buildTimedTempos(emit, RESOLUTION);
}

export function anchoredBeats(
  grid: Synctrack,
  maxMs = 240000.0,
  maxB = 4000,
): {beats: number[]; origin: number} {
  const origin = grid.origin_ms;
  const timed = buildOwnOriginTimedTempos(grid);

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

// ---------------------------------------------------------------------------
// REACH-EXTENSION (SHIPPED, Eli GO "ship guard alone", 2026-07-17). Port of
// `levers/kick_snare_warp_reach.py` (drum-to-chart analysis/product_pipeline).
// Supersedes the whole-song `warpGrid` above with a WINDOWED local-comb gate
// (fires on locally-steady 32-beat windows instead of requiring the whole
// song to pass one comb fit — 75% audio-material reach vs d5's 21%) plus a
// deployable post-snap note_ms self-guard that rejects the warp outright if
// it would worsen median post-snap note-to-onset fit by more than
// `noteMsTolMs`. `warpGrid`/d5 is kept above, untouched, behind its own
// `KS_WARP_ENABLED` flag — see chart-builder.ts.
// ---------------------------------------------------------------------------

/** Shipped reach config: `KSWarpConfig(lam=0.5, win_ms=70, gate_ks_p50_max=5,
 * gate_ks_inlf_min=0.90, gate_drift_ks_min=5)` — ratioLo/ratioHi keep the
 * DEFAULT_KS_WARP_CONFIG values (0.9/1.1), matching the Python reference's
 * dataclass field defaults (only p50/inlf/drift are overridden there). */
export const REACH_KS_WARP_CONFIG: KSWarpConfig = {
  ...DEFAULT_KS_WARP_CONFIG,
  gateKsP50MaxMs: 5.0,
  gateKsInlfMin: 0.9,
  gateDriftKsMinMs: 5.0,
};

export const REACH_WIN_BEATS = 32;
export const REACH_HOP_BEATS = 16;
export const REACH_NOTE_MS_TOL = 0.5;

export interface KSWarpWindowedDiag {
  nWin: number;
  nAdmWin: number;
  nBeatsWarped: number;
  admitted: boolean;
  reason?: string;
}

/** Port of kick_snare_warp_reach._beats_bpm_ts. */
function beatsBpmTs(
  synctrack: Synctrack,
): {beats: number[]; bpm0: number; ts: Synctrack['timeSignatures']} | null {
  const {beats} = anchoredBeats(synctrack);
  if (beats.length < 8) return null;
  const bpm0 = 60000.0 / median(diffArr(beats));
  return {beats, bpm0, ts: synctrack.timeSignatures};
}

/** Port of kick_snare_warp_reach._grid_from_warped: rebuilds a per-beat tempo
 * map from a (possibly non-monotonic, when mixing warped/incumbent beats)
 * warped-beat array — re-applies the running-max monotonicity fix, then the
 * same tempo-segment construction `warpGrid` uses. */
function gridFromWarped(
  warpedIn: number[],
  timeSignatures: Synctrack['timeSignatures'],
): Synctrack | null {
  const warped = warpedIn.slice();
  for (let k = 1; k < warped.length; k++) {
    if (warped[k] < warped[k - 1]) warped[k] = warped[k - 1];
  }
  const ts =
    timeSignatures && timeSignatures.length
      ? timeSignatures
      : [{ms: warped[0], numerator: 4, denominator: 4}];
  const tempos: TempoEvent[] = [];
  for (let bi = 0; bi < warped.length - 1; bi++) {
    const dt = warped[bi + 1] - warped[bi];
    if (dt > 1.0 && 60000.0 / dt >= 30.0 && 60000.0 / dt <= 400.0) {
      tempos.push({ms: warped[bi], bpm: 60000.0 / dt});
    }
  }
  if (tempos.length < 2) return null;
  return {origin_ms: warped[0], tempos, timeSignatures: ts};
}

/**
 * Windowed / sectional KS-warp gate: port of
 * `kick_snare_warp_reach.warp_grid_windowed`. Warps only the beats that fall
 * inside >=1 locally-steady, locally-drifted `winBeats`-beat window (hop
 * `hopBeats`); beats outside any admitted window keep their incumbent
 * position. The full-song soft-pull warp is computed once and then masked,
 * so window seams stay phase-continuous by construction (no downbeat break
 * at a boundary) — same trick as the Python reference.
 */
export function warpGridWindowed(
  synctrack: Synctrack,
  ksOnsetsMs: number[] | null,
  cfg: KSWarpConfig = REACH_KS_WARP_CONFIG,
  winBeats: number = REACH_WIN_BEATS,
  hopBeats: number = REACH_HOP_BEATS,
  minKsInWin = 8,
  minAdmWinFrac = 0.0,
  localDriftMaxMs: number | null = null,
): {grid: Synctrack | null; diag: KSWarpWindowedDiag} {
  const bt = beatsBpmTs(synctrack);
  if (bt === null) {
    return {
      grid: null,
      diag: {nWin: 0, nAdmWin: 0, nBeatsWarped: 0, admitted: false, reason: 'too_few_beats'},
    };
  }
  const {beats, bpm0, ts} = bt;

  const ks =
    ksOnsetsMs && ksOnsetsMs.length
      ? Array.from(ksOnsetsMs).sort((a, b) => a - b)
      : null;
  if (ks === null || ks.length < 8) {
    return {
      grid: null,
      diag: {nWin: 0, nAdmWin: 0, nBeatsWarped: 0, admitted: false, reason: 'too_few_ks'},
    };
  }

  const P = cfg.gateKsP50MaxMs;
  const I = cfg.gateKsInlfMin;
  const D = cfg.gateDriftKsMinMs;
  const nb = beats.length;
  const warpMask = new Array<boolean>(nb).fill(false);
  let nWin = 0;
  let nAdmWin = 0;
  let start = 0;
  while (start < nb) {
    const end = Math.min(start + winBeats, nb);
    if (end - start >= 8) {
      const wb = beats.slice(start, end);
      const lo = wb[0] - 1.0;
      const hi = wb[wb.length - 1] + 1.0;
      const wks = ks.filter(k => k >= lo && k <= hi);
      if (wks.length >= minKsInWin) {
        nWin++;
        const comb = combFit(wks, bpm0);
        const dloc = driftVsKs(wb, wks);
        const steady =
          comb !== null &&
          comb.p50 <= P &&
          comb.inlf >= I &&
          cfg.ratioLo <= comb.ratio &&
          comb.ratio <= cfg.ratioHi;
        const withinCap =
          localDriftMaxMs === null ||
          (dloc !== null && dloc <= localDriftMaxMs);
        if (steady && dloc !== null && dloc >= D && withinCap) {
          nAdmWin++;
          for (let k = start; k < end; k++) warpMask[k] = true;
        }
      }
    }
    if (end >= nb) break;
    start += hopBeats;
  }

  const nBeatsWarped = warpMask.reduce((n, w) => n + (w ? 1 : 0), 0);
  const diagBase = {nWin, nAdmWin, nBeatsWarped};
  if (nBeatsWarped === 0) {
    return {grid: null, diag: {...diagBase, admitted: false}};
  }
  if (nWin > 0 && nAdmWin / nWin < minAdmWinFrac) {
    return {
      grid: null,
      diag: {...diagBase, admitted: false, reason: 'too_few_steady_windows'},
    };
  }

  const warpedAll = warpBeats(beats, ks, cfg.winMs, cfg.lam);
  if (warpedAll === null) {
    return {
      grid: null,
      diag: {...diagBase, admitted: true, reason: 'warp_unconstructible'},
    };
  }
  const mixed = beats.map((b, i) => (warpMask[i] ? warpedAll[i] : b));
  const grid = gridFromWarped(mixed, ts);
  if (grid === null) {
    return {
      grid: null,
      diag: {...diagBase, admitted: true, reason: 'warp_unconstructible'},
    };
  }
  return {grid, diag: {...diagBase, admitted: true}};
}

/**
 * Snap one onset (already in the grid's own-origin frame, i.e.
 * `msRaw - grid.origin_ms`) to the musical grid for the note_ms guard. Port
 * of `stage89_snap.snap_onset_tick` with `flow="audio"` and
 * `lattice_config=None` fixed (the guard never varies these — see the
 * Python reference's `postsnap_note_median`), and the lane parameter
 * dropped: every lane currently resolves to the same 'candidate'
 * (16th/16th-triplet) snap mode (`CYMBAL_LANES` is empty in both the
 * Python reference and this app's `class-mapping.ts`), so lane-branching
 * would be dead code here too.
 */
function snapOnsetTickForGuard(
  msOwnOrigin: number,
  timed: TimedTempo[],
  resolution: number,
  toleranceMs: number,
  phaseAlignShiftMs: number,
): number {
  const adjMs = msOwnOrigin + SYSTEMATIC_ONSET_MS_AUDIO_FLOW + phaseAlignShiftMs;
  const frac = msToTick(adjMs, timed, resolution);
  const snapped = snapGroupToGrid(frac, resolution);
  const driftMs = Math.abs(tickToMs(snapped, timed, resolution) - adjMs);
  return driftMs > toleranceMs ? Math.max(0, Math.round(frac)) : snapped;
}

/**
 * Deployable post-snap note_ms self-guard: port of
 * `kick_snare_warp_reach.postsnap_note_median`. Snaps EVERY decoded onset
 * (all lanes, `ptMs` in absolute/raw ms — NOT pre-adjusted) to `grid`'s own
 * [16th, 16th-triplet] lattice, in the grid's own-origin frame, and returns
 * the median |snapped - onset| distance (ms). Applies the same audio-flow
 * phase-align search chart placement uses (own-origin frame, +
 * SYSTEMATIC_ONSET_MS_AUDIO_FLOW) before snapping, matching the reference
 * exactly.
 */
export function postsnapNoteMedian(
  grid: Synctrack | null,
  ptMs: number[] | null,
): number {
  if (grid === null || ptMs === null || ptMs.length === 0) return 0.0;
  const timed = buildOwnOriginTimedTempos(grid);
  const ptf = ptMs.map(ms => ms - grid.origin_ms);

  let pa = 0.0;
  if (ptf.length >= MIN_ONSETS_FOR_SEARCH) {
    const searchInput = ptf.map(ms => ms + SYSTEMATIC_ONSET_MS_AUDIO_FLOW);
    pa = computePhaseAlignShiftMs(
      searchInput,
      timed,
      RESOLUTION,
      DEFAULT_PHASE_ALIGN_CONFIG,
    ).shiftMs;
  }

  const notes: number[] = [];
  for (const msOwnOrigin of ptf) {
    const tk = snapOnsetTickForGuard(
      msOwnOrigin,
      timed,
      RESOLUTION,
      DEFAULT_SNAP_TOLERANCE_MS,
      pa,
    );
    notes.push(Math.abs(tickToMs(tk, timed, RESOLUTION) - msOwnOrigin));
  }
  return notes.length ? median(notes) : 0.0;
}

export interface KSWarpReachDiag extends KSWarpWindowedDiag {
  reason?: string;
  originRevertedBeats?: number;
}

/** Shipped origin-revert gate (ms): an admitted warp whose beat0 moved more
 * than this far triggers {@link partialOriginRevert}. `null` disables the
 * revert (pre-2026-07-18 behavior — reach_v1). */
export const REACH_ORIGIN_REVERT_GATE_MS = 400.0;

/** Leading-run revert tolerance (ms) — see {@link partialOriginRevert}. */
export const REACH_ORIGIN_REVERT_TOL_MS = 60.0;

/**
 * SURGICAL origin-mis-warp fix: port of
 * `kick_snare_warp_reach.partial_origin_revert` (2026-07-18, Eli GO "keep the
 * partial origin revert, apply it in all places"). The whole-song
 * origin-shift guard is REFUTED (it throws away the body warp); this reverts
 * ONLY the LEADING contiguous run of beats whose |warped − incumbent| >
 * `revertTolMs` back to incumbent positions, keeping the rest of the song's
 * warp — targets the sparse-intro pathology (a first window with no nearby
 * KS drags beat0 by hundreds/thousands of ms) without touching the body warp
 * (the audio win). Returns `{grid, nReverted}`; `nReverted === 0` (no
 * leading mis-warp) returns `fullGrid` unchanged (byte-identical).
 */
export function partialOriginRevert(
  fullGrid: Synctrack | null,
  incumbentGrid: Synctrack | null,
  revertTolMs: number = REACH_ORIGIN_REVERT_TOL_MS,
): {grid: Synctrack | null; nReverted: number} {
  if (fullGrid === null || incumbentGrid === null) {
    return {grid: fullGrid, nReverted: 0};
  }
  const {beats: wbFull} = anchoredBeats(fullGrid);
  const {beats: ibFull} = anchoredBeats(incumbentGrid);
  const k0 = Math.min(wbFull.length, ibFull.length);
  if (k0 < 8) {
    return {grid: fullGrid, nReverted: 0};
  }
  const wb = wbFull.slice(0, k0);
  const ib = ibFull.slice(0, k0);
  const diff = wb.map((w, i) => Math.abs(w - ib[i]));
  let k = 0;
  while (k < diff.length && diff[k] > revertTolMs) k++;
  if (k === 0) {
    return {grid: fullGrid, nReverted: 0};
  }
  const pr = wb.slice();
  for (let i = 0; i < k; i++) pr[i] = ib[i];
  const g = gridFromWarped(pr, fullGrid.timeSignatures);
  return {grid: g ?? fullGrid, nReverted: k};
}

/**
 * SHIPPED reach-extension public entry: port of
 * `kick_snare_warp_reach.warp_grid_reach`. Windowed KS-warp (no whole-song or
 * fraction gate — {@link REACH_KS_WARP_CONFIG}, `minAdmWinFrac=0`) followed
 * by the post-snap note_ms guard: rejects the warp (falls back to the
 * incumbent grid, returning `null`) if it would worsen the median post-snap
 * note-to-onset fit, over ALL decoded onsets (`allOnsetsMs`, raw/uncorrected
 * ms — the same "raw" decode contract as `ksOnsetsMs`), by more than
 * `noteMsTolMs`. Then, if the admitted warp moved beat0 by more than
 * `originRevertGateMs`, applies {@link partialOriginRevert} (surgical
 * leading-run revert, keeping the body warp) — `null` disables the revert.
 */
export function warpGridReach(
  synctrack: Synctrack,
  ksOnsetsMs: number[] | null,
  allOnsetsMs: number[] | null,
  cfg: KSWarpConfig = REACH_KS_WARP_CONFIG,
  winBeats: number = REACH_WIN_BEATS,
  hopBeats: number = REACH_HOP_BEATS,
  noteMsTolMs: number = REACH_NOTE_MS_TOL,
  originRevertGateMs: number | null = REACH_ORIGIN_REVERT_GATE_MS,
): {grid: Synctrack | null; diag: KSWarpReachDiag} {
  const {grid, diag} = warpGridWindowed(
    synctrack,
    ksOnsetsMs,
    cfg,
    winBeats,
    hopBeats,
    8,
    0.0,
    null,
  );
  if (grid === null) {
    return {grid: null, diag: {...diag, admitted: false}};
  }
  const warpedMedian = postsnapNoteMedian(grid, allOnsetsMs);
  const incumbentMedian = postsnapNoteMedian(synctrack, allOnsetsMs);
  if (warpedMedian > incumbentMedian + noteMsTolMs) {
    return {grid: null, diag: {...diag, admitted: false, reason: 'note_ms_guard'}};
  }

  let finalGrid = grid;
  let nReverted = 0;
  if (originRevertGateMs !== null) {
    const {beats: ib} = anchoredBeats(synctrack);
    const {beats: wb} = anchoredBeats(grid);
    if (
      ib.length &&
      wb.length &&
      Math.abs(wb[0] - ib[0]) > originRevertGateMs
    ) {
      const reverted = partialOriginRevert(grid, synctrack);
      finalGrid = reverted.grid ?? grid;
      nReverted = reverted.nReverted;
    }
  }
  return {
    grid: finalGrid,
    diag: {...diag, admitted: true, originRevertedBeats: nReverted},
  };
}
