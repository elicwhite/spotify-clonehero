/**
 * Post-processing of raw CRNN activations before peak picking.
 *
 * Exact port of postprocess() in scripts/dump_frontend_reference.py
 * (research repo), itself a port of the train_ab.py make_predict_fn
 * post-block:
 *
 *   1. Per-song tom RE-ORDER: a spectral pitch proxy (weighted mean of
 *      low mel bins 4..37 of the mono mel) is computed per frame; each tom
 *      lane's median pitch over its confident frames decides whether the
 *      tom columns should be permuted so that higher-pitch toms map to
 *      higher lanes (HT > MT > FT in pitch).
 *   2. Per-frame lane constraints: suppress 3rd+ ranked toms and cymbals
 *      above 0.4 (*0.2), resolve conflicting lane pairs, and promote
 *      crash-2 into crash when crash is silent.
 *
 * Lane order: [BD, SD, HT, MT, FT, HH, CR, CR2, RD].
 */

import {NUM_DRUM_CLASSES} from './types';

const TOM_LANES = [2, 3, 4];
const CYMBAL_LANES = [5, 6, 7, 8];
/** Conflicting (a, b) lane pairs: HH/HT, RD/MT, CR/FT. */
const LANE_CONFLICTS: readonly [number, number][] = [
  [5, 2],
  [8, 3],
  [6, 4],
];

/** Low mel-bin range for the tom pitch proxy: bins [LO_IDX, N_LOW). */
const LO_IDX = 4;
const N_LOW = 38;

/**
 * Float32 constants matching the reference exactly. NumPy 2 weak promotion
 * demotes the Python literals 0.4 / 0.2 to float32 before comparing or
 * multiplying with the float32 activations, so the JS port must compare
 * against float32(0.4) (not the float64 literal, which is slightly smaller)
 * and multiply in float32.
 */
const F32_04 = Math.fround(0.4);
const F32_02 = Math.fround(0.2);

/** Median of a numeric array (numpy semantics: mean of middle two if even). */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Apply the reference post-processing block to raw activations.
 *
 * @param activations - Raw sigmoid activations, layout [t * 9 + c]. Not
 *   mutated; a processed copy is returned.
 * @param T - Number of time frames.
 * @param monoMel - Mono (L/R mean) log-mel, time-major layout [t * 256 + m].
 * @returns The processed activations, same layout as the input.
 */
export function applyPostprocess(
  activations: Float32Array,
  T: number,
  monoMel: Float32Array,
): Float32Array {
  const act = new Float32Array(activations); // copy; mutated below
  const C = NUM_DRUM_CLASSES;
  const nMels = 256;

  // -------------------------------------------------------------------------
  // (1) Per-song tom re-order via low-bin pitch proxy
  // -------------------------------------------------------------------------
  const pitch = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const base = t * nMels;
    let rowMin = Infinity;
    for (let m = LO_IDX; m < N_LOW; m++) {
      const v = monoMel[base + m];
      if (v < rowMin) rowMin = v;
    }
    let wSum = 0;
    let wBinSum = 0;
    for (let m = LO_IDX; m < N_LOW; m++) {
      const w = Math.max(0, monoMel[base + m] - rowMin);
      wSum += w;
      wBinSum += w * m;
    }
    pitch[t] = wBinSum / (wSum + 1e-6);
  }

  // Median pitch per tom lane over its confident frames.
  const med = new Map<number, number>();
  for (const c of TOM_LANES) {
    const framePitches: number[] = [];
    for (let t = 0; t < T; t++) {
      const a = act[t * C + c];
      const tomMax = Math.max(act[t * C + 2], act[t * C + 3], act[t * C + 4]);
      if (a > 0.5 && a >= tomMax - 1e-6) {
        framePitches.push(pitch[t]);
      }
    }
    if (framePitches.length >= 4) {
      med.set(c, median(framePitches));
    }
  }

  if (med.size >= 2) {
    const lanes = [...med.keys()]; // insertion order = ascending lane
    // src: lanes sorted by DESCENDING median pitch (stable; ties keep
    // ascending lane order). dst: lanes sorted ascending.
    const src = lanes.slice().sort((a, b) => med.get(b)! - med.get(a)!);
    const dst = lanes.slice().sort((a, b) => a - b);
    if (src.some((c, i) => c !== dst[i])) {
      // Permute the tom columns: dst column receives src column.
      const perm = new Float32Array(T * TOM_LANES.length);
      for (let t = 0; t < T; t++) {
        for (let i = 0; i < TOM_LANES.length; i++) {
          perm[t * TOM_LANES.length + i] = act[t * C + TOM_LANES[i]];
        }
      }
      const col = new Map<number, number>([
        [2, 0],
        [3, 1],
        [4, 2],
      ]);
      for (let i = 0; i < src.length; i++) {
        const sCol = col.get(src[i])!;
        const dCol = col.get(dst[i])!;
        for (let t = 0; t < T; t++) {
          act[t * C + TOM_LANES[dCol]] = perm[t * TOM_LANES.length + sCol];
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // (2) Per-frame lane constraints
  // -------------------------------------------------------------------------
  // Python's sorted([(act, c)], reverse=True) sorts tuples descending
  // lexicographically: by activation desc, then by lane desc on exact ties.
  const byActDescLaneDesc = (
    a: {v: number; c: number},
    b: {v: number; c: number},
  ) => b.v - a.v || b.c - a.c;

  for (let t = 0; t < T; t++) {
    const row = t * C;

    // Suppress 3rd+ ranked toms above 0.4.
    const tomActs = TOM_LANES.map(c => ({v: act[row + c], c})).sort(
      byActDescLaneDesc,
    );
    for (let i = 2; i < tomActs.length; i++) {
      if (tomActs[i].v > F32_04) {
        act[row + tomActs[i].c] = Math.fround(act[row + tomActs[i].c] * F32_02);
      }
    }

    // Suppress 3rd+ ranked cymbals above 0.4.
    const cymActs = CYMBAL_LANES.map(c => ({v: act[row + c], c})).sort(
      byActDescLaneDesc,
    );
    for (let i = 2; i < cymActs.length; i++) {
      if (cymActs[i].v > F32_04) {
        act[row + cymActs[i].c] = Math.fround(act[row + cymActs[i].c] * F32_02);
      }
    }

    // Conflicting lane pairs: lower the weaker one (ties keep a).
    for (const [a, b] of LANE_CONFLICTS) {
      if (act[row + a] > F32_04 && act[row + b] > F32_04) {
        if (act[row + a] >= act[row + b]) {
          act[row + b] = Math.fround(act[row + b] * F32_02);
        } else {
          act[row + a] = Math.fround(act[row + a] * F32_02);
        }
      }
    }

    // Crash-2 promotion: if crash-2 fires while crash is silent, move it.
    if (act[row + 7] > F32_04 && act[row + 6] < F32_04) {
      act[row + 6] = act[row + 7];
      act[row + 7] = Math.fround(act[row + 7] * F32_02);
    }
  }

  return act;
}
