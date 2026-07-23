/**
 * Unit tests for the "Ours" v5 (packed-binary) tree evaluator: the rebinning
 * step, the binary survive path (tree walk + sigmoid + threshold), and —
 * critically — the multiclass relane path's `classes_` indirection, where a
 * head's columns are ordered by `classes_` and column `j` predicts
 * `lanes_list[classes_[j]]`, NOT `lanes_list[j]`. A synthetic head whose
 * `classes_` actually skips a value proves the indirection is applied.
 */

import {
  evalTree,
  rebin,
  relanePredict,
  surviveKeep,
  surviveProba,
  type RelaneModel,
  type SurviveModel,
  type Tree,
  type TreeNode,
} from '../model';

// A single edge at 0.5: raw value 0 rebins to bin 0, raw value 1 rebins to
// bin 1 (see `rebin`/`searchSortedLeft`'s `side='left'` semantics).
const BIN_EDGES_1FEAT = [new Float64Array([0.5])];

const leaf = (value: number): TreeNode => ({
  is_leaf: true,
  leaf_value: value,
  feature_idx: 0,
  bin_threshold: 0,
  missing_go_to_left: 0,
  left: -1,
  right: -1,
});

const split = (
  featureIdx: number,
  binThreshold: number,
  left: number,
  right: number,
): TreeNode => ({
  is_leaf: false,
  leaf_value: 0,
  feature_idx: featureIdx,
  bin_threshold: binThreshold,
  missing_go_to_left: 0,
  left,
  right,
});

const constTree = (value: number): Tree => ({nodes: [leaf(value)]});

describe('rebin', () => {
  test('smallest index i such that x <= edges[i] (side="left")', () => {
    const edges = [new Float64Array([10, 20, 30])];
    expect(rebin([5], edges)).toEqual(new Uint8Array([0]));
    expect(rebin([10], edges)).toEqual(new Uint8Array([0])); // boundary: <=10
    expect(rebin([15], edges)).toEqual(new Uint8Array([1]));
    expect(rebin([30], edges)).toEqual(new Uint8Array([2]));
    expect(rebin([31], edges)).toEqual(new Uint8Array([3])); // past all edges
  });

  test('clamps to 255', () => {
    const manyEdges = new Float64Array(300).map((_, i) => i);
    expect(rebin([1000], [manyEdges])[0]).toBe(255);
  });
});

describe('evalTree', () => {
  test('walks left iff bin <= bin_threshold', () => {
    // node0: bin[0] <= 0 ? node1 : node2
    const nodes: TreeNode[] = [split(0, 0, 1, 2), leaf(10), leaf(-10)];
    expect(evalTree(nodes, new Uint8Array([0]))).toBe(10);
    expect(evalTree(nodes, new Uint8Array([1]))).toBe(-10);
  });
});

describe('survive head (binary)', () => {
  const model: SurviveModel = {
    baseline: 0,
    threshold: 0.5,
    // feature[0] rebins to bin 0 or 1; bin<=0 -> +2, else -2
    trees: [{nodes: [split(0, 0, 1, 2), leaf(2), leaf(-2)]}],
    binEdges: BIN_EDGES_1FEAT,
  };
  const twoTree: SurviveModel = {
    ...model,
    trees: [...model.trees, constTree(0)],
  };

  test('sigmoid(baseline + sum leaves)', () => {
    expect(surviveProba(model, [0])).toBeCloseTo(1 / (1 + Math.exp(-2)), 12);
    expect(surviveProba(model, [1])).toBeCloseTo(1 / (1 + Math.exp(2)), 12);
    expect(surviveProba(twoTree, [0])).toBeCloseTo(
      surviveProba(model, [0]),
      12,
    );
  });

  test('keep iff proba >= threshold', () => {
    expect(surviveKeep(model, [0])).toBe(true); // proba ~0.88
    expect(surviveKeep(model, [1])).toBe(false); // proba ~0.12
  });
});

describe('relane head (multiclass) — classes_ indirection', () => {
  // 4 possible lanes, but only 3 columns: classes_ skips index 1 (open-hat),
  // mirroring the shipped cymbal head (classes_ = [0,2,3]). Column j predicts
  // lanes_list[classes_[j]].
  const lanes_list = ['hihat', 'open-hat', 'crash', 'ride'];
  const classes_ = [0, 2, 3];

  const headWinning = (winningColumn: number): RelaneModel => ({
    lanes_list,
    classes_,
    baseline: [0, 0, 0],
    class_trees: [0, 1, 2].map(j => [constTree(j === winningColumn ? 5 : 0)]),
    binEdges: BIN_EDGES_1FEAT,
  });

  test('maps the winning column through classes_, never lanes_list[column]', () => {
    // Column 1 wins. WRONG decode -> lanes_list[1] = "open-hat".
    // CORRECT decode -> lanes_list[classes_[1]] = lanes_list[2] = "crash".
    const {lane, confidence} = relanePredict(headWinning(1), [0]);
    expect(lane).toBe('crash');
    expect(lane).not.toBe(lanes_list[1]); // guards against the 2026-07-21 bug
    expect(confidence).toBeCloseTo(
      Math.exp(5) / (Math.exp(0) + Math.exp(5) + Math.exp(0)),
      9,
    );
  });

  test('every column decodes to its classes_-mapped lane', () => {
    expect(relanePredict(headWinning(0), [0]).lane).toBe('hihat'); // classes_[0]=0
    expect(relanePredict(headWinning(1), [0]).lane).toBe('crash'); // classes_[1]=2
    expect(relanePredict(headWinning(2), [0]).lane).toBe('ride'); //  classes_[2]=3
  });

  test('the skipped lane (open-hat) is never predicted', () => {
    const predicted = [0, 1, 2].map(
      c => relanePredict(headWinning(c), [0]).lane,
    );
    expect(predicted).not.toContain('open-hat');
  });

  test('argmax over softmax with a non-zero baseline and real tree walk', () => {
    // Feature-dependent trees; baseline biases column 2 but a strong column-0
    // leaf overrides it when feature[0] rebins to bin 0.
    const model: RelaneModel = {
      lanes_list,
      classes_,
      baseline: [0, 0, 1],
      class_trees: [
        [{nodes: [split(0, 0, 1, 2), leaf(3), leaf(-3)]}],
        [constTree(0)],
        [constTree(0)],
      ],
      binEdges: BIN_EDGES_1FEAT,
    };
    // feature[0]=0 -> column0 raw=3 wins -> hihat
    expect(relanePredict(model, [0]).lane).toBe('hihat');
    // feature[0]=1 -> column0 raw=-3; column2 raw=1 wins -> ride
    expect(relanePredict(model, [1]).lane).toBe('ride');
  });
});
