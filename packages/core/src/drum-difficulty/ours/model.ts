/**
 * "Ours" v5 ("591ab4a" packed) gradient-boosted-tree evaluator — a port of
 * `pack_model.py`'s `rebin` / `traverse_packed` / `predict_packed_binary` /
 * `predict_packed_multiclass`, reading the same `.bin` files it writes (see
 * `public/models/drum-difficulty/v5/manifest.json` and
 * `PRODUCT_INTEGRATION.md` §3/§4 in the drum-to-chart repo for the byte
 * layout). v5 ships the SAME trained trees as v4 (`model_cache_key`
 * unchanged, `08b9f91735e6dcf7`) and the SAME decode pipeline (`reduce.ts`
 * is untouched) — only the artifact format changed: a compact packed-binary
 * tree encoding (~1.9MB) replacing v4's pure-JSON tree dump (~36MB), read by
 * a custom byte-level evaluator instead of `JSON.parse`. No ONNX.
 *
 * The historical JSON format stored each split's raw threshold as an fp64
 * feature value; the packed format instead stores HistGBM's own internal
 * `bin_threshold` (a 0-255 bin index — every feature was already discretized
 * to <=256 bins at training time). This means a raw feature vector must be
 * **re-binned** into bin indices (via each feature's ascending bin-edge
 * table, `searchsorted(edges, x, side='left')`) before tree traversal —
 * `rebin()` below, run once per note per model. Getting `side='left'` wrong
 * silently produces a different, still-plausible-looking traversal (see
 * `pack_model.py`'s `rebin()` docstring) — do not "simplify" this to
 * `side='right'` or a linear scan without preserving that exact tie rule.
 *
 * Two head kinds (see manifest.json):
 *  - Survive (binary): `sigmoid(baseline + Σ tree leaf values)`, keep iff
 *    `proba >= threshold` (`threshold` comes from the manifest's global
 *    `survive_threshold`, not the `.bin` file itself — the packed SURV
 *    header carries no threshold field).
 *  - Relane (multiclass, one head per lane family): softmax over per-column
 *    `baseline[j] + Σ class_trees[j] leaf values`, argmax the column, then
 *    map the winning COLUMN through `classes_` to the real lane index —
 *    `lanes_list[classes_[j*]]`, NOT `lanes_list[j*]`. `classes_` skips any
 *    lane never seen as a relane target in training (the shipped cymbal head
 *    is `classes_ = [0,2,3]`, skipping open-hat), so the indirection is
 *    load-bearing.
 *
 * Leaf values already include the learning-rate shrinkage (baked in at pack
 * time) — never re-multiply. `missing_go_to_left` is carried in the byte
 * format for fidelity but is dead code here: our featurizer never produces a
 * missing (NaN) feature, so every bin index is always a valid, defined 0-255
 * value and the plain `<=` comparison always applies.
 *
 * `sigmoid`/`softmax` route through `./portableExp` (a fixed, engine-
 * independent `exp`, ported from the `drum-reducer-reference` project's
 * `portable_exp.{py,js}`) instead of the platform's `Math.exp` — see that
 * module's doc comment for why: `Math.exp` isn't guaranteed bit-identical
 * across browsers, which otherwise risks two users' browsers reducing the
 * exact same chart differently whenever a score lands within a few ULP of a
 * decode threshold.
 */

import {sigmoid, softmax} from './portableExp';

const NODE_SIZE = 7; // <BBBBBe>: feature_idx, bin_threshold, left, right, flags, value(f16)

export interface TreeNode {
  is_leaf: boolean;
  leaf_value: number;
  feature_idx: number;
  /** 0-255 bin index (NOT a raw feature value) — compare against a rebinned
   * feature vector, never a raw one. */
  bin_threshold: number;
  missing_go_to_left: number;
  left: number;
  right: number;
}

export interface Tree {
  nodes: TreeNode[];
}

/** Parsed `survive_{tier}.bin` (subset the evaluator needs). */
export interface SurviveModel {
  baseline: number;
  trees: Tree[];
  /** Set from `manifest.json`'s global `survive_threshold` at load time —
   * the packed SURV file itself carries no threshold field. */
  threshold: number;
  /** Per-feature ascending bin edges, for rebinning raw feature values. */
  binEdges: Float64Array[];
}

/** Parsed `relane_{family}_{tier}.bin` (subset the evaluator needs). */
export interface RelaneModel {
  lanes_list: string[];
  /** Column index -> real lane index. Length == number of columns. */
  classes_: number[];
  /** One baseline per column. */
  baseline: number[];
  /** `class_trees[column]` is that column's tree ensemble (across all
   * boosting iterations). */
  class_trees: Tree[][];
  binEdges: Float64Array[];
}

// ---------------------------------------------------------------------------
// fp16 decode
// ---------------------------------------------------------------------------

/** IEEE 754 half-precision -> JS number. Leaf values are the only field
 * stored this way (§3 of PRODUCT_INTEGRATION.md); everything else in the
 * packed format is u8/u16/u32/f64. */
function float16ToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

// ---------------------------------------------------------------------------
// Binary parsing
// ---------------------------------------------------------------------------

function readMagic(view: DataView): string {
  return String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
}

/** Read `nodeCount` flat `NODE_STRUCT` records starting at `offset`. Returns
 * the parsed tree and the number of bytes consumed. */
function readTree(
  view: DataView,
  offset: number,
  nodeCount: number,
): {tree: Tree; bytesRead: number} {
  const nodes: TreeNode[] = new Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const off = offset + i * NODE_SIZE;
    const feature_idx = view.getUint8(off);
    const bin_threshold = view.getUint8(off + 1);
    const left = view.getUint8(off + 2);
    const right = view.getUint8(off + 3);
    const flags = view.getUint8(off + 4);
    const is_leaf = (flags & 1) !== 0;
    const missing_go_to_left = flags & 2;
    const value = is_leaf ? float16ToNumber(view.getUint16(off + 5, true)) : 0;
    nodes[i] = {
      is_leaf,
      leaf_value: value,
      feature_idx,
      bin_threshold,
      missing_go_to_left,
      left,
      right,
    };
  }
  return {tree: {nodes}, bytesRead: nodeCount * NODE_SIZE};
}

/** Bin-edge table: per feature, `n_edges(u16)` then that many ascending
 * `f64` edge values. Identical layout in SURV and RLAN files, always the
 * last section of the file. */
function readBinEdges(
  view: DataView,
  offset: number,
  nFeatures: number,
): Float64Array[] {
  const edges: Float64Array[] = new Array(nFeatures);
  let off = offset;
  for (let j = 0; j < nFeatures; j++) {
    const nEdges = view.getUint16(off, true);
    off += 2;
    const arr = new Float64Array(nEdges);
    for (let k = 0; k < nEdges; k++) {
      arr[k] = view.getFloat64(off, true);
      off += 8;
    }
    edges[j] = arr;
  }
  return edges;
}

/** Parse a `survive_{tier}.bin` file. `threshold` is a placeholder (0.5);
 * the caller must overwrite it from the manifest's `survive_threshold`. */
export function parseSurviveBin(buf: ArrayBuffer): SurviveModel {
  const view = new DataView(buf);
  const magic = readMagic(view);
  if (magic !== 'SURV') {
    throw new Error(`bad survive model magic: expected "SURV", got "${magic}"`);
  }
  let off = 4;
  const version = view.getUint8(off);
  off += 1;
  if (version !== 1)
    throw new Error(`unsupported survive model version ${version}`);
  const nFeatures = view.getUint16(off, true);
  off += 2;
  const baseline = view.getFloat64(off, true);
  off += 8;
  off += 8; // learning_rate — unused: leaf values already have shrinkage baked in
  const nTrees = view.getUint32(off, true);
  off += 4;
  const nodeCounts: number[] = new Array(nTrees);
  for (let i = 0; i < nTrees; i++) {
    nodeCounts[i] = view.getUint16(off, true);
    off += 2;
  }
  const trees: Tree[] = new Array(nTrees);
  for (let i = 0; i < nTrees; i++) {
    const {tree, bytesRead} = readTree(view, off, nodeCounts[i]);
    trees[i] = tree;
    off += bytesRead;
  }
  const binEdges = readBinEdges(view, off, nFeatures);
  return {baseline, trees, threshold: 0.5, binEdges};
}

/** Parse a `relane_{family}_{tier}.bin` file. `lanesList` is the family's
 * fixed lane vocabulary (`manifest.json`'s `families.cymbal`/`families.tom`
 * — not stored in the `.bin` file itself). */
export function parseRelaneBin(
  buf: ArrayBuffer,
  lanesList: string[],
): RelaneModel {
  const view = new DataView(buf);
  const magic = readMagic(view);
  if (magic !== 'RLAN') {
    throw new Error(`bad relane model magic: expected "RLAN", got "${magic}"`);
  }
  let off = 4;
  const version = view.getUint8(off);
  off += 1;
  if (version !== 1)
    throw new Error(`unsupported relane model version ${version}`);
  const nFeatures = view.getUint16(off, true);
  off += 2;
  const nClasses = view.getUint8(off);
  off += 1;
  const classes_: number[] = new Array(nClasses);
  for (let c = 0; c < nClasses; c++) {
    classes_[c] = view.getUint8(off);
    off += 1;
  }
  const baseline: number[] = new Array(nClasses);
  for (let c = 0; c < nClasses; c++) {
    baseline[c] = view.getFloat64(off, true);
    off += 8;
  }
  off += 8; // learning_rate — unused: leaf values already have shrinkage baked in
  const nIters = view.getUint32(off, true);
  off += 4;
  const counts: number[] = new Array(nIters * nClasses);
  for (let i = 0; i < nIters * nClasses; i++) {
    counts[i] = view.getUint16(off, true);
    off += 2;
  }
  // Node bytes follow in the SAME iteration-major, class-major order as the
  // counts above. Regroup into class_trees[c] = every iteration's tree for
  // class c, matching the JSON format's `class_trees[column]` shape.
  const classTrees: Tree[][] = Array.from({length: nClasses}, () => []);
  let k = 0;
  for (let it = 0; it < nIters; it++) {
    for (let c = 0; c < nClasses; c++) {
      const {tree, bytesRead} = readTree(view, off, counts[k]);
      classTrees[c].push(tree);
      off += bytesRead;
      k++;
    }
  }
  const binEdges = readBinEdges(view, off, nFeatures);
  return {
    lanes_list: lanesList,
    classes_,
    baseline,
    class_trees: classTrees,
    binEdges,
  };
}

// ---------------------------------------------------------------------------
// Rebinning + tree evaluation
// ---------------------------------------------------------------------------

/** Smallest index `i` such that `x <= edges[i]`, i.e. `np.searchsorted(edges,
 * x, side='left')`. Must stay `side='left'` — see the module doc comment. */
function searchSortedLeft(edges: Float64Array, x: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x <= edges[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Re-bin a raw feature vector into 0-255 bin indices using a model's own
 * per-feature edge tables. `pack_model.py`'s `rebin()`. */
export function rebin(
  x: readonly number[],
  binEdges: readonly Float64Array[],
): Uint8Array {
  const out = new Uint8Array(x.length);
  for (let j = 0; j < x.length; j++) {
    const b = searchSortedLeft(binEdges[j], x[j]);
    out[j] = b > 255 ? 255 : b;
  }
  return out;
}

/** Walk one tree over an ALREADY-REBINNED feature vector, returning the
 * reached leaf value. */
export function evalTree(nodes: TreeNode[], xb: Uint8Array): number {
  let i = 0;
  for (;;) {
    const n = nodes[i];
    if (n.is_leaf) return n.leaf_value;
    i = xb[n.feature_idx] <= n.bin_threshold ? n.left : n.right;
  }
}

/** Survive head: `sigmoid(baseline + Σ leaf values)`. `x` is a raw feature
 * vector — rebinned internally against the model's own edge tables. */
export function surviveProba(model: SurviveModel, x: number[]): number {
  const xb = rebin(x, model.binEdges);
  let raw = model.baseline;
  for (const t of model.trees) raw += evalTree(t.nodes, xb);
  return sigmoid(raw);
}

/** Survive head decision: `proba >= threshold`. */
export function surviveKeep(model: SurviveModel, x: number[]): boolean {
  return surviveProba(model, x) >= model.threshold;
}

/**
 * Relane head: softmax over per-column raw scores, argmax, then map the
 * winning column through `classes_` to the real lane. Returns the predicted
 * lane and its softmax confidence. `x` is a raw feature vector — rebinned
 * internally (once) against the model's own edge tables.
 */
export function relanePredict(
  model: RelaneModel,
  x: number[],
): {lane: string; confidence: number} {
  const xb = rebin(x, model.binEdges);
  const nCols = model.classes_.length;
  const raw = model.baseline.slice();
  for (let j = 0; j < nCols; j++) {
    for (const t of model.class_trees[j]) raw[j] += evalTree(t.nodes, xb);
  }
  // The discrete lane choice is argmax(raw) — equal to argmax(softmax(raw))
  // since softmax is monotonic in each input, so it needs no exp at all.
  // Only the CONFIDENCE value (fed to relane-pool's weighted sum and
  // chord-merge's max) needs a real probability, via the portable softmax.
  let jStar = 0;
  for (let j = 1; j < nCols; j++) if (raw[j] > raw[jStar]) jStar = j;
  const proba = softmax(raw);
  return {
    lane: model.lanes_list[model.classes_[jStar]],
    confidence: proba[jStar],
  };
}

// ---------------------------------------------------------------------------
// Lazy model loading (browser runtime): the v5 model set is ~1.9MB (~0.9MB
// gzipped over the wire), fetched as raw bytes — never statically imported /
// bundled, never JSON.
// ---------------------------------------------------------------------------

export type Tier = 'hard' | 'medium' | 'easy';
export const TIERS: readonly Tier[] = ['hard', 'medium', 'easy'];

export interface OursModels {
  survive: Record<Tier, SurviveModel>;
  relane: Record<Tier, {cymbal: RelaneModel; tom: RelaneModel}>;
  /** `manifest.json`'s `family_nms_gaps_ms` — `null` means NMS is off for
   * that tier (hard). See `reduce.ts`'s `applyFamilyNms`. */
  familyNmsGapsMs: Record<Tier, number | null>;
}

interface ManifestJson {
  family_nms_gaps_ms: Record<Tier, number | null>;
  survive_threshold: number;
  families: {cymbal: string[]; tom: string[]};
}

const MODEL_BASE = '/models/drum-difficulty/v5';

let modelsPromise: Promise<OursModels> | null = null;

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${MODEL_BASE}/${name}`);
  if (!res.ok) {
    throw new Error(`failed to load Ours model ${name}: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function fetchBin(name: string): Promise<ArrayBuffer> {
  const res = await fetch(`${MODEL_BASE}/${name}`);
  if (!res.ok) {
    throw new Error(`failed to load Ours model ${name}: ${res.status}`);
  }
  return res.arrayBuffer();
}

/** Lazily fetch and cache the full v5 model set (survive + relane per tier,
 * plus the manifest's family-NMS gaps and global survive threshold). */
export function loadOursModels(): Promise<OursModels> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const manifest = await fetchJson<ManifestJson>('manifest.json');
      const survive = {} as Record<Tier, SurviveModel>;
      const relane = {} as Record<
        Tier,
        {cymbal: RelaneModel; tom: RelaneModel}
      >;
      await Promise.all(
        TIERS.map(async tier => {
          const [sBuf, cBuf, tBuf] = await Promise.all([
            fetchBin(`survive_${tier}.bin`),
            fetchBin(`relane_cymbal_${tier}.bin`),
            fetchBin(`relane_tom_${tier}.bin`),
          ]);
          const s = parseSurviveBin(sBuf);
          s.threshold = manifest.survive_threshold;
          survive[tier] = s;
          relane[tier] = {
            cymbal: parseRelaneBin(cBuf, manifest.families.cymbal),
            tom: parseRelaneBin(tBuf, manifest.families.tom),
          };
        }),
      );
      return {survive, relane, familyNmsGapsMs: manifest.family_nms_gaps_ms};
    })();
  }
  return modelsPromise;
}
