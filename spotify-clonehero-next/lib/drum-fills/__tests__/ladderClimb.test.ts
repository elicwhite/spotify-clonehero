import {
  climbLadder,
  initRungClimb,
  type LadderClimbOptions,
  type RungClimb,
} from '../practice/ladderClimb';

// Deterministic options for tests: entry tempo 90, symmetric ±10 steps, 2-run
// thresholds, floor 70, min 60, full 100.
const OPTS: Partial<LadderClimbOptions> = {
  rungEntryTempoPct: () => 90,
};

function pass(c: RungClimb, rungCount: number) {
  return climbLadder(c, rungCount, true, OPTS);
}
function fail(c: RungClimb, rungCount: number) {
  return climbLadder(c, rungCount, false, OPTS);
}

describe('initRungClimb', () => {
  it('enters a rung at its (clamped) entry tempo with empty tallies', () => {
    expect(initRungClimb(2, OPTS)).toEqual({
      index: 2,
      tempoPct: 90,
      passesAtTempo: 0,
      failsAtTempo: 0,
    });
  });

  it('clamps the entry tempo into [min, full]', () => {
    expect(initRungClimb(0, {rungEntryTempoPct: () => 130}).tempoPct).toBe(100);
    expect(initRungClimb(0, {rungEntryTempoPct: () => 30}).tempoPct).toBe(60);
  });
});

describe('climbLadder — speeding up before advancing', () => {
  it('speeds up after a passing run instead of advancing below full tempo', () => {
    let c = initRungClimb(0, OPTS); // 90%
    let r = pass(c, 3);
    expect(r.change).toBe('none'); // 1 pass, not yet a run
    r = pass(r.climb, 3);
    expect(r.change).toBe('speed-up');
    expect(r.climb.tempoPct).toBe(100);
    expect(r.climb.index).toBe(0);
  });

  it('advances a rung only at full tempo after a passing run', () => {
    let c: RungClimb = {index: 0, tempoPct: 100, passesAtTempo: 0, failsAtTempo: 0};
    let r = pass(c, 3);
    expect(r.change).toBe('none');
    r = pass(r.climb, 3);
    expect(r.change).toBe('advance');
    expect(r.climb.index).toBe(1);
    expect(r.climb.tempoPct).toBe(90); // entry tempo of the new rung
  });

  it('holds at the top rung when already at full tempo', () => {
    let c: RungClimb = {index: 2, tempoPct: 100, passesAtTempo: 1, failsAtTempo: 0};
    const r = pass(c, 3); // would be a 2-pass run
    expect(r.change).toBe('none');
    expect(r.climb.index).toBe(2);
  });
});

describe('climbLadder — slowing down before stepping back', () => {
  it('slows down on a failing run while above the floor', () => {
    let c = initRungClimb(1, OPTS); // 90%
    let r = fail(c, 3);
    expect(r.change).toBe('none'); // 1 fail
    r = fail(r.climb, 3);
    expect(r.change).toBe('slow-down');
    expect(r.climb.tempoPct).toBe(80);
    expect(r.climb.index).toBe(1);
  });

  it('a single pass clears the fail streak (no premature slow-down)', () => {
    let c = initRungClimb(1, OPTS);
    let r = fail(c, 3);
    r = pass(r.climb, 3);
    expect(r.climb.failsAtTempo).toBe(0);
    r = fail(r.climb, 3);
    expect(r.change).toBe('none'); // streak restarted, only 1 fail
  });

  it('steps back only once at/under the floor tempo, then resets to the easier rung', () => {
    // From 90: fail-run → 80, fail-run → 70 (== floor), fail-run → step back.
    let c = initRungClimb(2, OPTS);
    let r = fail(fail(c, 3).climb, 3); // → 80
    expect(r.climb.tempoPct).toBe(80);
    r = fail(fail(r.climb, 3).climb, 3); // → 70
    expect(r.climb.tempoPct).toBe(70);
    expect(r.change).toBe('slow-down');
    r = fail(r.climb, 3); // 1 fail at floor
    expect(r.change).toBe('none');
    r = fail(r.climb, 3); // 2nd fail at floor → step back
    expect(r.change).toBe('step-back');
    expect(r.climb.index).toBe(1);
    expect(r.climb.tempoPct).toBe(90); // entry tempo of the easier rung
  });

  it('takes 4–6 failing runs to step back depending on entry tempo', () => {
    const runsToStepBack = (entry: number) => {
      let c = initRungClimb(2, {rungEntryTempoPct: () => entry});
      let runs = 0;
      for (let i = 0; i < 50; i++) {
        const r = climbLadder(
          climbLadder(c, 3, false, {rungEntryTempoPct: () => entry}).climb,
          3,
          false,
          {rungEntryTempoPct: () => entry},
        );
        runs++;
        if (r.change === 'step-back') return runs;
        c = r.climb;
      }
      return runs;
    };
    expect(runsToStepBack(75)).toBeLessThanOrEqual(2);
    expect(runsToStepBack(90)).toBe(3);
  });

  it('cannot step back from the bottom rung; pins at the floor', () => {
    let c: RungClimb = {index: 0, tempoPct: 70, passesAtTempo: 0, failsAtTempo: 0};
    let r = fail(fail(c, 3).climb, 3); // floor-gated but index 0 → slow toward min
    expect(r.climb.index).toBe(0);
    expect(r.climb.tempoPct).toBe(60); // min
    // Further failing runs can't lower it or change rung.
    r = fail(fail(r.climb, 3).climb, 3);
    expect(r.change).toBe('none');
    expect(r.climb.tempoPct).toBe(60);
    expect(r.climb.index).toBe(0);
  });
});
