import {buildMeasures, MeasureMap} from '../measureMap';

const TPQN = 480;

function tuple(mm: MeasureMap, pos: number): [number, number, number, number] {
  const {measure, beat, tickInBeat, ticksSinceMeasureStart} = mm.mbt(pos);
  return [measure, beat, tickInBeat, ticksSinceMeasureStart];
}

// Ported tuple-for-tuple from test_reduce_port.py's mbt() tests.
describe('MeasureMap.mbt', () => {
  test('constant 4/4', () => {
    const mm = buildMeasures([], TPQN, 1920 * 8);
    expect(tuple(mm, 0)).toEqual([1, 1, 0, 0]);
    expect(tuple(mm, 479)).toEqual([1, 1, 479, 479]);
    expect(tuple(mm, 480)).toEqual([1, 2, 0, 480]);
    expect(tuple(mm, 1920)).toEqual([2, 1, 0, 0]);
    expect(tuple(mm, 1920 + 960)).toEqual([2, 3, 0, 960]);
  });

  test('mid-song time-signature change to 7/8', () => {
    const mm = buildMeasures(
      [
        [0, 4, 4],
        [7680, 7, 8],
      ],
      TPQN,
      7680 + 1680 * 4,
    );
    expect(tuple(mm, 5760)).toEqual([4, 1, 0, 0]);
    expect(tuple(mm, 7679)).toEqual([4, 4, 479, 1919]);
    expect(tuple(mm, 7680)).toEqual([5, 1, 0, 0]);
    expect(tuple(mm, 7680 + 240)).toEqual([5, 2, 0, 240]);
    expect(tuple(mm, 7680 + 240 * 6)).toEqual([5, 7, 0, 1440]);
    expect(tuple(mm, 7680 + 1680)).toEqual([6, 1, 0, 0]);
  });

  test('prepends a leading 4/4 when the first TS event is not at tick 0', () => {
    const withImplicit = buildMeasures([[1920, 3, 4]], TPQN, 1920 * 4);
    // Measures 1 (4/4) then 2+ (3/4). Tick 0 resolves in the implied 4/4 bar.
    expect(tuple(withImplicit, 0)).toEqual([1, 1, 0, 0]);
    expect(tuple(withImplicit, 1920)).toEqual([2, 1, 0, 0]);
    // 3/4 bar = 1440 ticks -> measure 3 at 1920+1440.
    expect(tuple(withImplicit, 1920 + 1440)).toEqual([3, 1, 0, 0]);
  });

  test('extrapolates the last measure indefinitely past the generated grid', () => {
    // end_tick 1920 generates only measures 1 (@0) and 2 (@1920). Positions
    // past that reuse measure 2's grid: the measure number stays 2 while the
    // beat count grows unbounded (bisect over start ticks, no "ran off end").
    const mm = buildMeasures([], TPQN, 1920);
    expect(mm.measures).toHaveLength(2);
    const t = mm.mbt(1920 + 480 * 5); // 5 beats into the extrapolated bar
    expect(t.measure).toBe(2);
    expect(t.beat).toBe(6);
    expect(t.tickInBeat).toBe(0);
    expect(t.ticksSinceMeasureStart).toBe(480 * 5);
  });

  test('negative positions clamp to the first measure', () => {
    const mm = buildMeasures([], TPQN, 1920);
    expect(mm.mbt(-10).measure).toBe(1);
  });
});
