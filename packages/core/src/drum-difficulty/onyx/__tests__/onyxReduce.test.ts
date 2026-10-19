/**
 * Unit tests ported tuple-for-tuple from
 * `~/projects/drum-to-chart/analysis/hopcat_reduction_eval/tests/
 * test_onyx_reduce.py`, including the synthetic 6/8-bar test validating the
 * beats-within-measure convention (AMBIGUITY #2).
 */

import {Rational} from '../../rational';
import {
  buildMeasureMap,
  isAligned,
  isMeasure,
  priority,
  keepSnares,
  keepKit,
  keepKicks,
  ensureOdNotes,
  type FlatGem,
  type Kept,
} from '../drumsReduce';
import {
  computePro,
  gemEq,
  gemKey,
  KICK,
  pro,
  RED,
  type Gem,
} from '../computePro';

const r = (n: number, d = 1) => Rational.of(n, d);
const strs = (xs: Rational[]) => xs.map(x => x.toString());
const keptAt = (kept: Kept, pos: Rational) => kept.get(pos.toString());
const gemKeys = (gs: Gem[] | undefined) => (gs ?? []).map(gemKey);

describe('measure map', () => {
  test('4/4', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(20));
    expect(strs(mm.starts.slice(0, 6))).toEqual(
      strs([r(0), r(4), r(8), r(12), r(16), r(20)]),
    );
    expect(mm.beatsWithinMeasure(r(5)).eq(r(1))).toBe(true);
    // 7.5 -> measure@4, rel=3.5
    expect(mm.beatsWithinMeasure(r(15, 2)).eq(r(7, 2))).toBe(true);
  });

  test('6/8 is three quarter-beats long', () => {
    // 6/8: bar length in quarter-note beats = 6*4/8 = 3.
    const mm = buildMeasureMap([{start: r(0), num: 6, den: 8}], r(10));
    expect(strs(mm.starts.slice(0, 4))).toEqual(strs([r(0), r(3), r(6), r(9)]));
  });

  test('ts change mid song', () => {
    // 4/4 for 2 bars (0..8), then 3/4 from beat 8.
    const mm = buildMeasureMap(
      [
        {start: r(0), num: 4, den: 4},
        {start: r(8), num: 3, den: 4},
      ],
      r(14),
    );
    expect(strs(mm.starts)).toEqual(strs([r(0), r(4), r(8), r(11), r(14)]));
  });
});

describe('is_measure and is_aligned', () => {
  test('matches expected', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    expect(isMeasure(mm, r(0))).toBe(true);
    expect(isMeasure(mm, r(4))).toBe(true);
    expect(isMeasure(mm, r(1))).toBe(false);
    expect(isAligned(mm, r(2), r(2))).toBe(true); // half-note aligned
    expect(isAligned(mm, r(2), r(1))).toBe(false);
    expect(isAligned(mm, r(1), r(3))).toBe(true); // quarter-note aligned
    expect(isAligned(mm, r(1, 2), r(1, 2))).toBe(true); // eighth-note aligned
    expect(isAligned(mm, r(1, 2), r(1, 3))).toBe(false);
  });
});

describe('priority', () => {
  test('ranking matches expected order', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    expect(priority(mm, r(0))).toBe(0);
    expect(priority(mm, r(2))).toBe(1);
    expect(priority(mm, r(1))).toBe(2);
    expect(priority(mm, r(1, 2))).toBe(3);
    expect(priority(mm, r(1, 3))).toBe(4);
  });
});

describe('keep_snares', () => {
  test('candidate near beat 0 survives via truncated-subtraction window', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    const positions = [r(0), r(1, 4)];
    // Hard padding 1/2. For 1/4: `1/4 -| 1/2 = 0` (monus clamps), so the window
    // is the OPEN interval (0, 3/4), which excludes the kept note at beat 0 —
    // both notes survive.
    const {kept, keys} = keepSnares(mm, 'h', positions);
    expect(strs(keys)).toEqual(strs([r(0), r(1, 4)]));
    expect(gemKeys(keptAt(kept, r(0)))).toEqual(gemKeys([RED]));
  });

  test('padding differs hard vs other', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    const positions = [r(0), r(3, 4)];
    const h = keepSnares(mm, 'h', positions);
    expect(strs(h.keys)).toEqual(strs([r(0), r(3, 4)])); // Hard padding 0.5
    // Medium padding 1: `3/4 -| 1 = 0`, so the window is the OPEN interval
    // (0, 7/4), which still excludes beat 0 — both survive.
    const m = keepSnares(mm, 'm', positions);
    expect(strs(m.keys)).toEqual(strs([r(0), r(3, 4)]));
  });
});

describe('keep_kit', () => {
  test('collapses yellow+green pair to green', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    const kit = [
      {pos: r(0), gems: [pro('yellow', 'cymbal'), pro('green', 'cymbal')]},
    ];
    const {kept} = keepKit(mm, 'h', kit, new Map(), []);
    expect(gemKeys(keptAt(kept, r(0)))).toEqual(
      gemKeys([pro('green', 'cymbal')]),
    );
  });

  test('collapses yellow+blue pair to blue', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    const kit = [
      {pos: r(0), gems: [pro('yellow', 'cymbal'), pro('blue', 'cymbal')]},
    ];
    const {kept} = keepKit(mm, 'h', kit, new Map(), []);
    expect(gemKeys(keptAt(kept, r(0)))).toEqual(
      gemKeys([pro('blue', 'cymbal')]),
    );
  });

  test('collapses double tom only on medium and easy', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    const kit = [{pos: r(0), gems: [pro('yellow', 'tom'), pro('blue', 'tom')]}];
    const h = keepKit(mm, 'h', kit, new Map(), []);
    expect((keptAt(h.kept, r(0)) ?? []).map(g => g.color).sort()).toEqual([
      'blue',
      'yellow',
    ]); // Hard: untouched
    const m = keepKit(mm, 'm', kit, new Map(), []);
    expect(gemKeys(keptAt(m.kept, r(0)))).toEqual(
      gemKeys([pro('yellow', 'tom')]),
    );
    const e = keepKit(mm, 'e', kit, new Map(), []);
    expect(gemKeys(keptAt(e.kept, r(0)))).toEqual(
      gemKeys([pro('yellow', 'tom')]),
    );
  });
});

describe('keep_kicks', () => {
  test('medium drops non-isolated inter-hand kicks', () => {
    // Placed at beat 4 (not 0): at beat 0 the collision window `(0 -| padding,
    // padding)` clamps to the OPEN interval (0, padding), which excludes the
    // beat-0 hand gems, so the drop rule can't see them — see the dedicated
    // beat-0 edge test below.
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    const mkKept = (): Kept =>
      new Map([[r(4).toString(), [RED, pro('yellow', 'cymbal')]]]);
    const m = keepKicks(mm, 'm', [r(4)], mkKept(), [r(4)]);
    expect((keptAt(m.kept, r(4)) ?? []).some(g => gemEq(g, KICK))).toBe(false);
    const h = keepKicks(mm, 'h', [r(4)], mkKept(), [r(4)]);
    expect((keptAt(h.kept, r(4)) ?? []).some(g => gemEq(g, KICK))).toBe(true);
  });

  test('beat-0 kick survives: truncated-subtraction window excludes beat 0', () => {
    // `0 -| padding = 0`, so the Medium collision window is the OPEN interval
    // (0, 2), which excludes the hand gems sitting exactly at beat 0. With no
    // colliding note visible, the kick at beat 0 is kept (matches true Haskell).
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    const kept: Kept = new Map([
      [r(0).toString(), [RED, pro('yellow', 'cymbal')]],
    ]);
    const m = keepKicks(mm, 'm', [r(0)], kept, [r(0)]);
    expect((keptAt(m.kept, r(0)) ?? []).some(g => gemEq(g, KICK))).toBe(true);
  });

  test('medium keeps isolated kick', () => {
    const mm = buildMeasureMap([{start: r(0), num: 4, den: 4}], r(8));
    const kept: Kept = new Map([[r(0).toString(), [RED]]]);
    const m = keepKicks(mm, 'm', [r(0)], kept, [r(0)]);
    expect((keptAt(m.kept, r(0)) ?? []).some(g => gemEq(g, KICK))).toBe(true);
  });
});

describe('ensure_od_notes', () => {
  test('reinserts when reduced phrase is empty', () => {
    const original: FlatGem[] = [
      {pos: r(0), gem: KICK},
      {pos: r(1), gem: RED},
      {pos: r(2), gem: pro('yellow', 'cymbal')},
    ];
    const out = ensureOdNotes([{start: r(0), end: r(4)}], original, []);
    expect(out.length).toBe(1);
    expect(out[0].pos.eq(r(0))).toBe(true);
    expect(gemEq(out[0].gem, KICK)).toBe(true);
  });

  test('leaves already-covered phrase alone', () => {
    const original: FlatGem[] = [{pos: r(0), gem: KICK}];
    const reduced: FlatGem[] = [{pos: r(1), gem: RED}];
    const out = ensureOdNotes([{start: r(0), end: r(4)}], original, reduced);
    expect(out.length).toBe(1);
    expect(out[0].pos.eq(r(1))).toBe(true);
    expect(gemEq(out[0].gem, RED)).toBe(true);
  });
});

describe('compute_pro', () => {
  test('resolves tom vs cymbal', () => {
    const raw = [
      {pos: r(0), gem: {kind: 'pro', color: 'yellow', protype: ''} as Gem},
      {pos: r(1), gem: {kind: 'pro', color: 'yellow', protype: ''} as Gem},
    ];
    const tomStatus = {
      yellow: [
        {pos: r(0), value: true},
        {pos: r(2), value: false},
      ],
    };
    const out = computePro(raw, tomStatus, []);
    expect(gemKeys(out.map(o => o.gem))).toEqual(
      gemKeys([pro('yellow', 'tom'), pro('yellow', 'tom')]),
    );
  });

  test('disco flips red and yellow', () => {
    const raw = [
      {pos: r(0), gem: RED},
      {pos: r(0), gem: {kind: 'pro', color: 'yellow', protype: ''} as Gem},
    ];
    const disco = [{pos: r(0), value: true}];
    const out = computePro(raw, {}, disco);
    const kinds = new Set(out.map(o => gemKey(o.gem)));
    expect(kinds.has(gemKey(pro('yellow', 'cymbal')))).toBe(true); // Red -> Yellow Cymbal
    expect(kinds.has(gemKey(RED))).toBe(true); // Yellow -> Red
  });
});
