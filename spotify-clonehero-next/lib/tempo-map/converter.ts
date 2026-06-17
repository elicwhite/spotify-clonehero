/**
 * Heuristic beats-to-synctrack converter.
 *
 * Port of `beats_to_synctrack` from the autoresearch-tempo SOTA pipeline
 * (train.py at git dbc913d), via the byte-exact JS port proven in
 * ~/projects/drum-to-chart/browser-pipeline. Only the SOTA-default code
 * paths are included; default-OFF env knobs are omitted.
 */

import type {Synctrack, TempoEvent, TimeSignatureEvent} from './types';

// --- locked SOTA constants ---------------------------------------------
export const SOTA = {
  DRUM_BEAT_AVG: true,
  DRUM_BEAT_AVG_TOL_MS: 50,
  DRUM_BEAT_AVG_WEIGHT: 0.45,
  CONTINUOUS_LAG: true,
  CONTINUOUS_LAG_INTERCEPT: 9,
  CONTINUOUS_LAG_MAX_MS: 15,
  LAG_DOWNBEATS: true,
  DEDUP_THR: 0.6,
  GAPFILL_THR: 1.5,
  OCTAVE_FIX: true,
  OCTAVE_HALVE_THR_BPM: 245.0,
  OCTAVE_HALVE_RATIO_LO: 0.45,
  OCTAVE_HALVE_RATIO_HI: 0.55,
  OCTAVE_DOUBLE_THR_BPM: 110.0,
  OCTAVE_DOUBLE_RATIO_LO: 1.8,
  OCTAVE_DOUBLE_RATIO_HI: 2.2,
  OCTAVE_THREE_HALVES: true,
  OCTAVE_THREE_HALVES_THR_BPM: 180.0,
  OCTAVE_THREE_HALVES_RATIO_LO: 1.15,
  OCTAVE_THREE_HALVES_RATIO_HI: 1.85,
  DUPBPM_COLLAPSE: true,
  DUPBPM_EPS: 1e-3,
  NUM_N4_PRIOR: 0.22,
  NUM_INFERRED_OVERRIDE: true,
  ORIGIN_PHASE_SHIFT: true,
  ORIGIN_PHASE_MARGIN: 0.07,
  ORIGIN_PHASE_TOL_MS: 50.0,
  ORIGIN_PHASE_K_RANGE_MULT: 1,
  ORIGIN_PHASE_BACKWARD_K: 4,
  ORIGIN_PHASE_MAX_K0: 0.6,
} as const;

// --- prepare.py helpers (β-coordinate maps) ----------------------------

/** Piecewise-constant tempo segments from originMs onward; segMs[0] is
 * forced to originMs. */
function tempoArrays(tempos: TempoEvent[], originMs: number) {
  let ms = tempos.map(t => Math.max(t.ms, originMs));
  let bpm = tempos.map(t => t.bpm);
  // dedupe ascending (np.diff(ms) > 0)
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
  const {segMs, segBpm} = tempoArrays(tempos, originMs);
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

function betasToTime(
  betas: number[],
  tempos: TempoEvent[],
  originMs: number,
): number[] {
  const {segMs, segBpm} = tempoArrays(tempos, originMs);
  const segDur = segBpm.map(b => 60_000.0 / b);
  const cum = [0.0];
  for (let i = 0; i < segMs.length - 1; i++) {
    cum.push(cum[i] + (segMs[i + 1] - segMs[i]) / segDur[i]);
  }
  return betas.map(b => {
    let idx = 0;
    while (idx < cum.length && cum[idx] <= b) idx++;
    idx = Math.max(0, Math.min(cum.length - 1, idx - 1));
    return segMs[idx] + (b - cum[idx]) * segDur[idx];
  });
}

function beatTimes(
  tempos: TempoEvent[],
  originMs: number,
  endMs: number,
): number[] {
  const lastBeta = timeToBeta(endMs, tempos, originMs);
  const n = Math.floor(lastBeta) + 1;
  if (n <= 0) return [];
  const arr: number[] = [];
  for (let i = 0; i < n; i++) arr.push(i);
  return betasToTime(arr, tempos, originMs);
}

function downbeatTimes(
  tempos: TempoEvent[],
  timeSigs: TimeSignatureEvent[],
  originMs: number,
  endMs: number,
): number[] {
  const beats = beatTimes(tempos, originMs, endMs);
  if (beats.length === 0) return [];
  const ts: Array<[number, number]> =
    timeSigs && timeSigs.length
      ? timeSigs.map(s => [s.ms, s.numerator | 0])
      : [[originMs, 4]];
  const db: number[] = [];
  let bi = 0;
  while (bi < beats.length) {
    const t = beats[bi];
    let num = 4;
    for (const [tsMs, n] of ts) {
      if (tsMs <= t + 1e-6) num = n;
      else break;
    }
    db.push(t);
    bi += Math.max(1, num);
  }
  return db;
}

// --- small helpers ------------------------------------------------------

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function diff(arr: number[]): number[] {
  const out = new Array(arr.length - 1);
  for (let i = 0; i < arr.length - 1; i++) out[i] = arr[i + 1] - arr[i];
  return out;
}

/** searchsorted(sortedArr, x) — first index where sortedArr[i] >= x */
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

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// --- ported per-step helpers --------------------------------------------

export function fillBeatGaps(beatsMs: number[], threshold = 1.75): number[] {
  if (beatsMs.length < 3) return beatsMs;
  const iois = diff(beatsMs);
  const ref = median(iois);
  if (ref <= 0) return beatsMs;
  const out = [beatsMs[0]];
  for (let i = 0; i < iois.length; i++) {
    const ratio = iois[i] / ref;
    if (ratio > threshold) {
      const nInsert = Math.max(Math.round(ratio) - 1, 1);
      const step = iois[i] / (nInsert + 1);
      for (let k = 1; k <= nInsert; k++) out.push(beatsMs[i] + step * k);
    }
    out.push(beatsMs[i + 1]);
  }
  return out;
}

export function backExtrapOrigin(beatsMs: number[]): number {
  if (beatsMs.length < 2) return beatsMs[0];
  const first = beatsMs[0];
  const firstIoi = beatsMs[1] - beatsMs[0];
  if (firstIoi <= 0) return first;
  const k = Math.round(first / firstIoi);
  return first - k * firstIoi;
}

export function dedupShortIois(
  beatsMs: number[],
  logitsAtBeats: number[] | null,
  threshold = 0.6,
): number[] {
  if (beatsMs.length < 3) return beatsMs;
  const iois = diff(beatsMs);
  const med = median(iois);
  if (med <= 0) return beatsMs;
  const keep = new Array(beatsMs.length).fill(true);
  for (let i = 0; i < iois.length; i++) {
    if (!(keep[i] && keep[i + 1])) continue;
    if (iois[i] < threshold * med) {
      if (logitsAtBeats) {
        if (logitsAtBeats[i] >= logitsAtBeats[i + 1]) keep[i + 1] = false;
        else keep[i] = false;
      } else {
        keep[i + 1] = false;
      }
    }
  }
  return beatsMs.filter((_, i) => keep[i]);
}

function maybeOctaveCorrect(
  beatsMs: number[],
  dsIoiMs: number | null,
): {beats: number[]; applied: boolean} {
  if (beatsMs.length < 4) return {beats: beatsMs, applied: false};
  const predIoi = median(diff(beatsMs));
  if (predIoi <= 0) return {beats: beatsMs, applied: false};
  const predBpm = 60_000.0 / predIoi;
  if (dsIoiMs == null || dsIoiMs <= 0) return {beats: beatsMs, applied: false};
  const ratio = predIoi / dsIoiMs;
  if (
    predBpm > SOTA.OCTAVE_HALVE_THR_BPM &&
    ratio >= SOTA.OCTAVE_HALVE_RATIO_LO &&
    ratio <= SOTA.OCTAVE_HALVE_RATIO_HI
  ) {
    return {beats: beatsMs.filter((_, i) => i % 2 === 0), applied: true};
  }
  const interpolateDouble = () => {
    const out: number[] = [];
    for (let i = 0; i < beatsMs.length - 1; i++) {
      out.push(beatsMs[i]);
      out.push((beatsMs[i] + beatsMs[i + 1]) / 2);
    }
    out.push(beatsMs[beatsMs.length - 1]);
    return out;
  };
  if (
    predBpm < SOTA.OCTAVE_DOUBLE_THR_BPM &&
    ratio >= SOTA.OCTAVE_DOUBLE_RATIO_LO &&
    ratio <= SOTA.OCTAVE_DOUBLE_RATIO_HI
  ) {
    return {beats: interpolateDouble(), applied: true};
  }
  if (
    SOTA.OCTAVE_THREE_HALVES &&
    predBpm < SOTA.OCTAVE_THREE_HALVES_THR_BPM &&
    ratio >= SOTA.OCTAVE_THREE_HALVES_RATIO_LO &&
    ratio <= SOTA.OCTAVE_THREE_HALVES_RATIO_HI
  ) {
    return {beats: interpolateDouble(), applied: true};
  }
  return {beats: beatsMs, applied: false};
}

// --- main converter ------------------------------------------------------

export interface BeatsToSynctrackInput {
  /** Full-mix PP beat times (seconds). */
  beats: number[];
  /** Full-mix PP downbeat times (seconds). */
  downbeats: number[];
  /** Full-mix beat logits (T frames @ fps). */
  beatLogits?: Float32Array | null;
  fps?: number;
  /** Median IOI (ms) of drum-stem PP beats; for OCTAVE_FIX. */
  drumStemPpIoiMs?: number | null;
  /** Drum-stem spectral-flux median offset (ms); for CONTINUOUS_LAG. */
  drumOnsetOffsetMs?: number | null;
  /** Drum-stem PP beats (seconds); for DRUM_BEAT_AVG. */
  drumPpBeatsSec?: number[] | null;
}

/**
 * Convert PP beats + downbeats into a synctrack
 * `{origin_ms, tempos:[{ms,bpm}], timeSignatures:[{ms,numerator,denominator}]}`.
 * Returns null when there are too few beats to work with.
 */
export function beatsToSynctrack({
  beats,
  downbeats,
  beatLogits = null,
  fps = 50.0,
  drumStemPpIoiMs = null,
  drumOnsetOffsetMs = null,
  drumPpBeatsSec = null,
}: BeatsToSynctrackInput): Synctrack | null {
  let beatsMs = beats
    .slice()
    .sort((a, b) => a - b)
    .map(s => s * 1000);
  let downbeatsMs = downbeats
    .slice()
    .sort((a, b) => a - b)
    .map(s => s * 1000);
  if (beatsMs.length < 2) return null;

  // DRUM_BEAT_AVG: average each fm beat with the nearest drum-stem beat
  // within DRUM_BEAT_AVG_TOL_MS, weighted by DRUM_BEAT_AVG_WEIGHT.
  if (SOTA.DRUM_BEAT_AVG && drumPpBeatsSec && drumPpBeatsSec.length > 0) {
    const tol = SOTA.DRUM_BEAT_AVG_TOL_MS;
    const w = SOTA.DRUM_BEAT_AVG_WEIGHT;
    const dsMs = Array.from(drumPpBeatsSec)
      .sort((a, b) => a - b)
      .map(s => s * 1000);
    const nb = beatsMs.length;
    const newBeats = new Array(nb);
    for (let i = 0; i < nb; i++) {
      const fm = beatsMs[i];
      const ii = searchsortedLeft(dsMs, fm);
      let best = Infinity;
      if (ii > 0) best = Math.min(best, Math.abs(dsMs[ii - 1] - fm));
      if (ii < dsMs.length) best = Math.min(best, Math.abs(dsMs[ii] - fm));
      let bestVal = fm;
      if (ii > 0 && Math.abs(dsMs[ii - 1] - fm) === best)
        bestVal = dsMs[ii - 1];
      if (ii < dsMs.length && Math.abs(dsMs[ii] - fm) === best)
        bestVal = dsMs[ii];
      if (best <= tol) newBeats[i] = (1 - w) * fm + w * bestVal;
      else newBeats[i] = fm;
    }
    beatsMs = newBeats;
  }

  // CONTINUOUS_LAG: shift beats (and downbeats) by
  // clip(-drum_onset_offset - INTERCEPT, 0, MAX).
  let lagAmt = 0;
  if (SOTA.CONTINUOUS_LAG && drumOnsetOffsetMs != null) {
    lagAmt = Math.max(
      0,
      Math.min(
        SOTA.CONTINUOUS_LAG_MAX_MS,
        -drumOnsetOffsetMs - SOTA.CONTINUOUS_LAG_INTERCEPT,
      ),
    );
  }
  if (lagAmt > 0) {
    beatsMs = beatsMs.map(b => b - lagAmt);
    if (SOTA.LAG_DOWNBEATS) downbeatsMs = downbeatsMs.map(d => d - lagAmt);
  }

  // Dedup short IOIs.
  let logitsAtBeats: number[] | null = null;
  if (beatLogits && beatsMs.length > 0) {
    logitsAtBeats = beatsMs.map(b => {
      const idx = Math.max(
        0,
        Math.min(beatLogits.length - 1, Math.floor((b / 1000) * fps)),
      );
      return sigmoid(beatLogits[idx]);
    });
  }
  beatsMs = dedupShortIois(beatsMs, logitsAtBeats, SOTA.DEDUP_THR);

  // Fill missed-beat gaps.
  beatsMs = fillBeatGaps(beatsMs, SOTA.GAPFILL_THR);

  // Octave correction.
  if (SOTA.OCTAVE_FIX) {
    ({beats: beatsMs} = maybeOctaveCorrect(beatsMs, drumStemPpIoiMs));
  }

  // Phase-aware origin via back-extrapolation.
  let origin = backExtrapOrigin(beatsMs);

  // Per-beat tempo events.
  const iois = diff(beatsMs);
  const bpms = iois.map(io => 60_000.0 / Math.max(io, 1e-3));
  let tempos: TempoEvent[] = [];
  for (let i = 0; i < iois.length; i++)
    tempos.push({ms: beatsMs[i], bpm: bpms[i]});
  tempos.push({ms: beatsMs[beatsMs.length - 1], bpm: bpms[bpms.length - 1]});

  // Numerator via selfconsist with N4_PRIOR.
  let num = 4;
  if (downbeatsMs.length >= 3 && tempos.length >= 4) {
    const candidates = [3, 4, 5, 6, 7];
    let bestN = 4,
      bestScore = -1;
    const endMs = Math.max(...tempos.map(t => t.ms));
    const selectDownbeats = downbeatsMs; // full-mix only (NUM_DRUM_VOTE off)
    for (const N of candidates) {
      const barsPred = downbeatTimes(
        tempos,
        [{ms: origin, numerator: N, denominator: 4}],
        origin,
        endMs,
      );
      if (barsPred.length === 0) continue;
      const dists: number[] = [];
      for (const p of selectDownbeats) {
        const ii = searchsortedLeft(barsPred, p);
        const candDists: number[] = [];
        if (ii > 0) candDists.push(Math.abs(barsPred[ii - 1] - p));
        if (ii < barsPred.length) candDists.push(Math.abs(barsPred[ii] - p));
        if (candDists.length) dists.push(Math.min(...candDists));
      }
      if (dists.length === 0) continue;
      const matched = dists.filter(d => d <= 30).length / dists.length;
      let score = matched;
      if (N === 4) score += SOTA.NUM_N4_PRIOR;
      if (score > bestScore) {
        bestScore = score;
        bestN = N;
      }
    }
    // NUM_INFERRED_OVERRIDE (3 -> 4)
    if (SOTA.NUM_INFERRED_OVERRIDE && bestN === 3 && downbeatsMs.length >= 3) {
      const dbSpacings = diff(downbeatsMs);
      const medDb = dbSpacings.length ? median(dbSpacings) : 0;
      const medIoi = iois.length ? median(iois) : 0;
      if (medIoi > 0 && Math.round(medDb / medIoi) === 4) {
        bestN = 4;
      }
    }
    num = bestN;
  }

  // ORIGIN_PHASE_SHIFT.
  if (
    SOTA.ORIGIN_PHASE_SHIFT &&
    num >= 2 &&
    tempos.length >= 4 &&
    downbeatsMs.length >= 3
  ) {
    const opsUnion = downbeatsMs.slice();
    if (opsUnion.length >= 3) {
      const margin = SOTA.ORIGIN_PHASE_MARGIN;
      const tolMs = SOTA.ORIGIN_PHASE_TOL_MS;
      const endMs = Math.max(...tempos.map(t => t.ms));
      const beatsUnder = beatTimes(tempos, origin, endMs);
      if (beatsUnder.length >= num + 1) {
        const scoreK = (testOrigin: number) => {
          const barsK = downbeatTimes(
            tempos,
            [{ms: testOrigin, numerator: num, denominator: 4}],
            testOrigin,
            endMs,
          );
          if (barsK.length === 0) return 0.0;
          let hits = 0;
          for (const b of barsK) {
            const ii = searchsortedLeft(opsUnion, b);
            const dL = ii > 0 ? Math.abs(opsUnion[ii - 1] - b) : 1e9;
            const dR = ii < opsUnion.length ? Math.abs(opsUnion[ii] - b) : 1e9;
            if (Math.min(dL, dR) <= tolMs) hits++;
          }
          return hits / barsK.length;
        };
        const scoreK0 = scoreK(origin);
        let bestK = 0,
          bestScore = scoreK0;
        const kMax = num * SOTA.ORIGIN_PHASE_K_RANGE_MULT;
        for (let k = 1; k < kMax; k++) {
          if (k >= beatsUnder.length) break;
          const sK = scoreK(beatsUnder[k]);
          if (sK > bestScore) {
            bestScore = sK;
            bestK = k;
          }
        }
        // BACKWARD_K
        const backK = SOTA.ORIGIN_PHASE_BACKWARD_K;
        if (backK > 0 && beatsUnder.length >= 2) {
          const firstB = beatsUnder[0];
          const ioiEst = beatsUnder[1] - beatsUnder[0];
          if (ioiEst > 0) {
            for (let k = 1; k <= backK; k++) {
              const testOrigin = firstB - k * ioiEst;
              const sK = scoreK(testOrigin);
              if (sK > bestScore) {
                bestScore = sK;
                bestK = -k;
              }
            }
          }
        }
        // MAX_K0 gate: don't shift if score_k0 is already plausible
        const maxK0Ok = scoreK0 < SOTA.ORIGIN_PHASE_MAX_K0;
        if (bestK !== 0 && bestScore - scoreK0 >= margin && maxK0Ok) {
          let newOrigin: number;
          if (bestK < 0) {
            const firstB = beatsUnder[0];
            const ioiEst = beatsUnder[1] - beatsUnder[0];
            newOrigin = firstB - Math.abs(bestK) * ioiEst;
          } else {
            newOrigin = beatsUnder[bestK];
          }
          // ORIGIN_PHASE_PREPEND: prepend (newOrigin, survivingBpm)
          const msa = tempos.map(t => t.ms);
          const bpms2 = tempos.map(t => t.bpm);
          let survIdx = searchsortedLeft(msa, newOrigin) - 1;
          survIdx = Math.max(0, Math.min(bpms2.length - 1, survIdx));
          const survBpm = bpms2[survIdx];
          if (survBpm > 0) {
            const newTempos: TempoEvent[] = [{ms: newOrigin, bpm: survBpm}];
            for (const t of tempos) {
              if (t.ms > newOrigin + 0.5) newTempos.push(t);
            }
            tempos = newTempos;
          }
          origin = newOrigin;
        }
      }
    }
  }

  // DUPBPM_COLLAPSE: drop adjacent tempos with identical BPM.
  if (SOTA.DUPBPM_COLLAPSE && tempos.length >= 2) {
    const eps = SOTA.DUPBPM_EPS;
    const kept = [tempos[0]];
    for (let i = 1; i < tempos.length; i++) {
      if (Math.abs(tempos[i].bpm - kept[kept.length - 1].bpm) <= eps) continue;
      kept.push(tempos[i]);
    }
    tempos = kept;
  }

  return {
    origin_ms: origin,
    tempos,
    timeSignatures: [{ms: origin, numerator: num, denominator: 4}],
  };
}
