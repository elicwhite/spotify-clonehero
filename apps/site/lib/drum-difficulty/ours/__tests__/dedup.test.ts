/**
 * Unit tests for the chord-merge dedup in `reduceOursTier`, exercised in
 * isolation with hand-built feature rows + synthetic heads: two different-lane
 * family notes that relane to the SAME lane at the SAME tick must collapse to
 * the single highest-confidence survivor; fixed (non-family) notes never merge.
 */

import {reduceOursTier} from '../reduce';
import type {FeatureRow} from '../featurize';
import type {RelaneModel, SurviveModel, Tree, TreeNode} from '../model';

// No groove-pooling in these tests — an empty cluster map makes both pooling
// steps a no-op regardless of `msToMeasure`'s (never-called) implementation.
const NO_MEASURE_CLOCK = (): [number, number] => [0, 0];
const NO_CLUSTERS = new Map<string, number[]>();

// Feature 0's bin edges: a single edge at 0.5, so raw value 0 rebins to bin
// 0 and raw value 1 rebins to bin 1 (see `model.ts`'s `rebin`/`searchSortedLeft`).
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

// Always-keep survive head.
const surviveAll: SurviveModel = {
  baseline: 10,
  threshold: 0.5,
  trees: [],
  binEdges: BIN_EDGES_1FEAT,
};

// Cymbal head: column 1 (-> classes_[1]=2 -> "crash") always wins, with
// confidence driven by feature[0] (bin<=0 => strong leaf 5, else weaker leaf 2).
const cymbalHead: RelaneModel = {
  lanes_list: ['hihat', 'open-hat', 'crash', 'ride'],
  classes_: [0, 2, 3],
  baseline: [0, 0, 0],
  class_trees: [
    [constTree(0)],
    [{nodes: [split(0, 0, 1, 2), leaf(5), leaf(2)]}],
    [constTree(0)],
  ],
  binEdges: BIN_EDGES_1FEAT,
};
const tomHead: RelaneModel = {
  lanes_list: ['high-tom', 'mid-tom', 'floor-tom'],
  classes_: [0, 1, 2],
  baseline: [0, 0, 0],
  class_trees: [[constTree(0)], [constTree(0)], [constTree(0)]],
  binEdges: BIN_EDGES_1FEAT,
};

const row = (
  tick: number,
  ms: number,
  lane: string,
  family: FeatureRow['family'],
  f0: number,
): FeatureRow => ({tick, ms, lane, family, features: [f0]});

describe('reduceOursTier — chord-merge dedup', () => {
  test('two family notes relaning to the same lane at the same tick collapse to the highest-confidence one', () => {
    const rows: FeatureRow[] = [
      row(100, 100, 'kick', 'fixed', 0), // fixed, passes through
      row(100, 100, 'crash', 'cymbal', 0), // -> crash, strong conf
      row(100, 100, 'ride', 'cymbal', 1), // -> crash, weaker conf (dropped)
      row(200, 200, 'hihat', 'cymbal', 0), // -> crash, different tick (kept)
    ];
    const out = reduceOursTier(
      rows,
      surviveAll,
      {cymbal: cymbalHead, tom: tomHead},
      null,
      NO_MEASURE_CLOCK,
      NO_CLUSTERS,
    );

    // kick@100, crash@100 (from the strong "crash" row), crash@200.
    expect(out).toHaveLength(3);
    expect(out.map(n => `${n.tick}:${n.lane}`)).toEqual([
      '100:kick',
      '100:crash',
      '200:crash',
    ]);
    // The surviving @100 cymbal note is the strong one (original lane crash).
    const at100 = out.find(n => n.tick === 100 && n.lane === 'crash')!;
    expect(at100.originalLane).toBe('crash');
    expect(at100.relaned).toBe(false);
    // The weaker "ride"->"crash" note was dropped, so no ride remains.
    expect(out.some(n => n.lane === 'ride')).toBe(false);
    // The @200 note relaned hihat -> crash.
    const at200 = out.find(n => n.tick === 200)!;
    expect(at200.relaned).toBe(true);
    expect(at200.originalLane).toBe('hihat');
  });

  test('fixed notes at the same tick are never deduped, even with the same lane', () => {
    const rows: FeatureRow[] = [
      row(100, 100, 'kick', 'fixed', 0),
      row(100, 100, 'kick', 'fixed', 0),
      row(100, 100, 'snare', 'fixed', 0),
    ];
    const out = reduceOursTier(
      rows,
      surviveAll,
      {cymbal: cymbalHead, tom: tomHead},
      null,
      NO_MEASURE_CLOCK,
      NO_CLUSTERS,
    );
    expect(out).toHaveLength(3);
    expect(out.filter(n => n.lane === 'kick')).toHaveLength(2);
  });

  test('dropped (non-surviving) notes are excluded', () => {
    const surviveNone: SurviveModel = {
      baseline: -10,
      threshold: 0.5,
      trees: [],
      binEdges: BIN_EDGES_1FEAT,
    };
    const rows: FeatureRow[] = [row(100, 100, 'crash', 'cymbal', 0)];
    const out = reduceOursTier(
      rows,
      surviveNone,
      {cymbal: cymbalHead, tom: tomHead},
      null,
      NO_MEASURE_CLOCK,
      NO_CLUSTERS,
    );
    expect(out).toHaveLength(0);
  });
});
