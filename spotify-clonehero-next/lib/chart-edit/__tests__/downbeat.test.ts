import {
  MAX_TS_DENOMINATOR,
  meterForGap,
  planDownbeatAt,
  planTimeSignatureMove,
  type DownbeatPlan,
  type DownbeatPlanOk,
} from '../downbeat';
import {deriveBeatGrid, type TimeSignatureInput} from '../bar-derivation';

const RES = 192;
const BAR = RES * 4; // one 4/4 bar at resolution 192

const FOUR_FOUR: TimeSignatureInput[] = [
  {tick: 0, numerator: 4, denominator: 4},
];

function ok(plan: DownbeatPlan): DownbeatPlanOk {
  if (plan.status !== 'ok') {
    throw new Error(`expected an ok plan, got ${plan.status}`);
  }
  return plan;
}

/** Ticks of every bar line the derived grid places in `[0, endTick]`. */
function barTicks(
  timeSignatures: readonly TimeSignatureInput[],
  endTick: number,
): number[] {
  return deriveBeatGrid(timeSignatures, RES, endTick)
    .filter(beat => beat.isDownbeat)
    .map(beat => beat.tick);
}

describe('meterForGap', () => {
  test('keeps the region denominator when the gap is a whole number of its beats', () => {
    // Half a 4/4 bar reads as 2/4, not 1/2.
    expect(meterForGap(BAR / 2, RES, 4)).toEqual({
      numerator: 2,
      denominator: 4,
    });
    expect(meterForGap(RES, RES, 4)).toEqual({numerator: 1, denominator: 4});
  });

  test('moves finer only as far as the gap requires', () => {
    // A bar short by a sixteenth: 15/16.
    expect(meterForGap(BAR - RES / 4, RES, 4)).toEqual({
      numerator: 15,
      denominator: 16,
    });
    // Three eighths: 3/8.
    expect(meterForGap((RES / 2) * 3, RES, 4)).toEqual({
      numerator: 3,
      denominator: 8,
    });
  });

  test('never coarsens below the region denominator', () => {
    // A quarter note inside an x/8 region stays in eighths: 2/8.
    expect(meterForGap(RES, RES, 8)).toEqual({numerator: 2, denominator: 8});
  });

  test('returns null when no legal denominator divides the gap', () => {
    // 5 ticks is not a whole number of 64ths at resolution 192 (a 64th is 12).
    expect(meterForGap(5, RES, 4)).toBeNull();
    expect(meterForGap(0, RES, 4)).toBeNull();
  });

  test('the finest denominator it will use is a 64th', () => {
    expect(meterForGap(RES / 16, RES, 4)).toEqual({
      numerator: 1,
      denominator: MAX_TS_DENOMINATOR,
    });
  });
});

describe('planDownbeatAt', () => {
  test('a target already on a bar line is a no-op, authored or derived', () => {
    // A plain derived bar line: the bar already starts here, so there is
    // nothing to place and no chip is added.
    expect(planDownbeatAt(FOUR_FOUR, RES, BAR * 3)).toEqual({
      status: 'noop',
      reason: 'already-a-bar-line',
    });

    // Same answer when the bar line does carry an authored signature.
    const authored: TimeSignatureInput[] = [
      {tick: 0, numerator: 4, denominator: 4},
      {tick: BAR * 3, numerator: 4, denominator: 4},
    ];
    expect(planDownbeatAt(authored, RES, BAR * 3)).toEqual({
      status: 'noop',
      reason: 'already-a-bar-line',
    });
  });

  test('tick 0 and negative ticks are rejected', () => {
    expect(planDownbeatAt(FOUR_FOUR, RES, 0)).toEqual({
      status: 'noop',
      reason: 'invalid-target',
    });
    expect(planDownbeatAt(FOUR_FOUR, RES, -RES)).toEqual({
      status: 'noop',
      reason: 'invalid-target',
    });
  });

  test('a downbeat a sixteenth early shortens the preceding measure to 15/16', () => {
    const sixteenth = RES / 4;
    const target = BAR * 4 - sixteenth;
    const plan = ok(planDownbeatAt(FOUR_FOUR, RES, target));

    expect(plan.shortMeasure).toEqual({
      tick: BAR * 3,
      numerator: 15,
      denominator: 16,
    });
    expect(plan.resumed).toEqual({tick: target, numerator: 4, denominator: 4});
    expect(plan.timeSignatures).toEqual([
      {tick: 0, numerator: 4, denominator: 4},
      {tick: BAR * 3, numerator: 15, denominator: 16},
      {tick: target, numerator: 4, denominator: 4},
    ]);
  });

  test('every later bar line follows from the new downbeat', () => {
    const sixteenth = RES / 4;
    const target = BAR * 4 - sixteenth;
    const plan = ok(planDownbeatAt(FOUR_FOUR, RES, target));
    const bars = barTicks(plan.timeSignatures, target + BAR * 3);

    expect(bars).toContain(target);
    expect(bars).toContain(target + BAR);
    expect(bars).toContain(target + BAR * 2);
    // The old, drifted grid position is gone.
    expect(bars).not.toContain(BAR * 4);
    // Bars before the edit are untouched.
    expect(bars.slice(0, 4)).toEqual([0, BAR, BAR * 2, BAR * 3]);
  });

  test('the measure that absorbs the gap is exactly the gap long', () => {
    const target = BAR * 2 + RES * 3 + RES / 2; // 3.5 beats into bar 3
    const plan = ok(planDownbeatAt(FOUR_FOUR, RES, target));
    const short = plan.shortMeasure!;
    const beatTicks = (RES * 4) / short.denominator;
    expect(short.numerator * beatTicks).toBe(target - BAR * 2);
  });

  test('a target in the first measure rewrites the tick-0 signature', () => {
    const target = RES * 3; // beat 4 of bar 1
    const plan = ok(planDownbeatAt(FOUR_FOUR, RES, target));

    expect(plan.timeSignatures).toEqual([
      {tick: 0, numerator: 3, denominator: 4},
      {tick: target, numerator: 4, denominator: 4},
    ]);
    // The chart still opens with a signature at tick 0.
    expect(plan.timeSignatures[0].tick).toBe(0);
    expect(barTicks(plan.timeSignatures, BAR * 3)).toEqual([
      0,
      target,
      target + BAR,
      target + BAR * 2,
    ]);
  });

  test('a gap no legal signature can measure is reported, not rounded', () => {
    const target = BAR * 2 + 5;
    const plan = planDownbeatAt(FOUR_FOUR, RES, target);
    expect(plan).toEqual({
      status: 'inexact',
      reason: 'gap-not-expressible',
      gapTicks: 5,
      barStartTick: BAR * 2,
      maxDenominator: MAX_TS_DENOMINATOR,
    });
  });

  test('repeating the same placement never stacks odd measures', () => {
    const target = BAR * 4 - RES / 4;
    const first = ok(planDownbeatAt(FOUR_FOUR, RES, target));
    expect(planDownbeatAt(first.timeSignatures, RES, target)).toEqual({
      status: 'noop',
      reason: 'already-a-bar-line',
    });
  });

  test('an existing later meter change survives untouched', () => {
    const signatures: TimeSignatureInput[] = [
      {tick: 0, numerator: 4, denominator: 4},
      {tick: BAR * 8, numerator: 3, denominator: 4},
    ];
    const target = BAR * 2 + RES;
    const plan = ok(planDownbeatAt(signatures, RES, target));
    expect(plan.timeSignatures).toContainEqual({
      tick: BAR * 8,
      numerator: 3,
      denominator: 4,
    });
    expect(plan.resumed).toEqual({tick: target, numerator: 4, denominator: 4});
  });

  test('the resumed meter is the region’s own, including /8 meters', () => {
    const signatures: TimeSignatureInput[] = [
      {tick: 0, numerator: 6, denominator: 8},
    ];
    const sixEight = 6 * (RES / 2); // 6 eighth notes
    const target = sixEight * 2 + RES / 2; // one eighth into bar 3
    const plan = ok(planDownbeatAt(signatures, RES, target));
    expect(plan.shortMeasure).toEqual({
      tick: sixEight * 2,
      numerator: 1,
      denominator: 8,
    });
    expect(plan.resumed).toEqual({tick: target, numerator: 6, denominator: 8});
  });

  test('an explicit meter overrides the region meter after the bar line', () => {
    const target = BAR * 2 + RES;
    const plan = ok(
      planDownbeatAt(FOUR_FOUR, RES, target, {numerator: 7, denominator: 8}),
    );
    expect(plan.resumed).toEqual({tick: target, numerator: 7, denominator: 8});
    expect(plan.shortMeasure).toEqual({
      tick: BAR * 2,
      numerator: 1,
      denominator: 4,
    });
  });
});

describe('planTimeSignatureMove', () => {
  const signatures: TimeSignatureInput[] = [
    {tick: 0, numerator: 4, denominator: 4},
    {tick: BAR * 4, numerator: 7, denominator: 8},
  ];

  test('carries the moved marker’s own meter to the new tick', () => {
    const target = BAR * 4 + RES; // one quarter later
    const plan = ok(planTimeSignatureMove(signatures, RES, BAR * 4, target));
    expect(plan.resumed).toEqual({tick: target, numerator: 7, denominator: 8});
    // Nothing is left at the old tick but the short measure the move opened.
    expect(plan.timeSignatures).toContainEqual({
      tick: BAR * 4,
      numerator: 1,
      denominator: 4,
    });
    expect(
      plan.timeSignatures.filter(
        ts => ts.numerator === 7 && ts.tick !== target,
      ),
    ).toEqual([]);
  });

  test('the measure before the drop absorbs the difference', () => {
    const target = BAR * 4 + RES;
    const plan = ok(planTimeSignatureMove(signatures, RES, BAR * 4, target));
    // With the 7/8 marker removed the region is 4/4 throughout, so the bar
    // the drop lands in starts at BAR*4 and is cut to a single quarter.
    expect(plan.shortMeasure).toEqual({
      tick: BAR * 4,
      numerator: 1,
      denominator: 4,
    });
  });

  test('dropping a marker back where it started is a no-op', () => {
    expect(planTimeSignatureMove(signatures, RES, BAR * 4, BAR * 4)).toEqual({
      status: 'noop',
      reason: 'already-a-bar-line',
    });
  });

  test('the tick-0 signature never moves', () => {
    expect(planTimeSignatureMove(signatures, RES, 0, BAR)).toEqual({
      status: 'noop',
      reason: 'invalid-target',
    });
  });

  test('a missing source marker is a no-op', () => {
    expect(planTimeSignatureMove(signatures, RES, BAR * 5, BAR * 6)).toEqual({
      status: 'noop',
      reason: 'invalid-target',
    });
  });

  test('an unmeasurable drop tick is reported, not rounded', () => {
    const plan = planTimeSignatureMove(signatures, RES, BAR * 4, BAR * 4 + 5);
    expect(plan.status).toBe('inexact');
  });
});
