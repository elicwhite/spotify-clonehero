import {deriveBeatGrid} from '@/lib/chart-edit/bar-derivation';

import {computeBeatGrid, GridOverlayConfig} from '../GridOverlay';

const RESOLUTION = 192;

/** 120bpm constant: one quarter note = 500ms, one tick = 500/192 ms. */
function makeConfig(
  overrides: Partial<GridOverlayConfig> = {},
): GridOverlayConfig {
  return {
    tempos: [{tick: 0, beatsPerMinute: 120}],
    timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
    resolution: RESOLUTION,
    durationMs: 10_000,
    highwayWidth: 1,
    highwaySpeed: 1,
    ...overrides,
  };
}

function tickMs(tick: number): number {
  return (tick / RESOLUTION) * 500;
}

describe('computeBeatGrid', () => {
  test('4/4: quarter-note beats, measure line every 4 beats', () => {
    const beats = computeBeatGrid(makeConfig({durationMs: 4000}));

    expect(beats.map(b => b.tick)).toEqual([
      0, 192, 384, 576, 768, 960, 1152, 1344, 1536,
    ]);
    expect(beats.map(b => b.isMeasure)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(beats[1].msTime).toBeCloseTo(500);
    expect(beats[4].msTime).toBeCloseTo(2000);
  });

  test('6/8: eighth-note beats, measure line every 6 beats', () => {
    const beats = computeBeatGrid(
      makeConfig({
        timeSignatures: [{tick: 0, numerator: 6, denominator: 8}],
        durationMs: 3000,
      }),
    );

    // Eighth note = 96 ticks; measure = 576 ticks
    expect(beats[0]).toMatchObject({tick: 0, isMeasure: true});
    expect(beats[1]).toMatchObject({tick: 96, isMeasure: false});
    expect(beats.filter(b => b.isMeasure).map(b => b.tick)).toEqual([
      0, 576, 1152,
    ]);
  });

  test('17/16 bar: 17 sixteenth beats, next region re-anchors at TS tick', () => {
    // Two 4/4 measures, one 17/16 measure, back to 4/4.
    const oddStart = 2 * 4 * RESOLUTION; // 1536
    const oddEnd = oddStart + 17 * (RESOLUTION / 4); // 1536 + 816 = 2352
    const beats = computeBeatGrid(
      makeConfig({
        timeSignatures: [
          {tick: 0, numerator: 4, denominator: 4},
          {tick: oddStart, numerator: 17, denominator: 16},
          {tick: oddEnd, numerator: 4, denominator: 4},
        ],
        durationMs: tickMs(oddEnd + 8 * RESOLUTION),
      }),
    );

    // The 17/16 region contains exactly 17 beats, 48 ticks apart,
    // starting with a measure line and no other measure line inside.
    const odd = beats.filter(b => b.tick >= oddStart && b.tick < oddEnd);
    expect(odd).toHaveLength(17);
    expect(odd[0]).toMatchObject({tick: oddStart, isMeasure: true});
    expect(odd.slice(1).every(b => !b.isMeasure)).toBe(true);
    expect(odd[16].tick).toBe(oddStart + 16 * 48);

    // The following 4/4 region re-anchors at 2352 (12.25 quarter notes —
    // NOT a multiple of the resolution) with quarter-note beats.
    const after = beats.filter(b => b.tick >= oddEnd);
    expect(after[0]).toMatchObject({tick: oddEnd, isMeasure: true});
    expect(after[1].tick).toBe(oddEnd + RESOLUTION);
    expect(after[0].msTime).toBeCloseTo(tickMs(oddEnd));
    expect(
      beats.filter(b => b.isMeasure && b.tick > oddEnd).map(b => b.tick),
    ).toEqual([oddEnd + 4 * RESOLUTION, oddEnd + 8 * RESOLUTION]);
  });

  test('no time signatures: defaults to 4/4 from tick 0', () => {
    const beats = computeBeatGrid(
      makeConfig({timeSignatures: [], durationMs: 2000}),
    );
    expect(beats.map(b => b.tick)).toEqual([0, 192, 384, 576, 768]);
    expect(beats[0].isMeasure).toBe(true);
  });

  test('late first TS: implicit 4/4 covers the gap from tick 0', () => {
    const beats = computeBeatGrid(
      makeConfig({
        timeSignatures: [{tick: 768, numerator: 3, denominator: 4}],
        durationMs: 4000,
      }),
    );
    expect(beats.slice(0, 5).map(b => b.tick)).toEqual([0, 192, 384, 576, 768]);
    expect(
      beats.filter(b => b.isMeasure).map(b => b.tick),
    ).toEqual([0, 768, 1344]);
  });

  test('tempo change affects msTime but not tick spacing', () => {
    const beats = computeBeatGrid(
      makeConfig({
        tempos: [
          {tick: 0, beatsPerMinute: 120},
          {tick: 384, beatsPerMinute: 60}, // quarter note = 1000ms after this
        ],
        durationMs: 4000,
      }),
    );
    expect(beats[2].msTime).toBeCloseTo(1000);
    expect(beats[3].msTime).toBeCloseTo(2000);
    expect(beats[3].tick).toBe(576);
  });

  test('no tempos yields empty grid', () => {
    expect(computeBeatGrid(makeConfig({tempos: []}))).toEqual([]);
  });

  test('bar/beat lattice matches the shared derivation module exactly', () => {
    // "One derivation for every derived fact" (plan 0062): the highway's
    // ticks and measure flags are the shared module's output, not a
    // parallel computation.
    const config = makeConfig({
      timeSignatures: [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: 1536, numerator: 6, denominator: 8},
        {tick: 1536 + 2 * 576, numerator: 7, denominator: 8},
      ],
      durationMs: 10_000,
    });
    const beats = computeBeatGrid(config);
    const derived = deriveBeatGrid(
      config.timeSignatures,
      RESOLUTION,
      Math.round(config.durationMs / (500 / RESOLUTION)),
    );
    expect(beats.map(b => ({tick: b.tick, isDownbeat: b.isMeasure}))).toEqual(
      derived.map(b => ({tick: b.tick, isDownbeat: b.isDownbeat})),
    );
  });
});
