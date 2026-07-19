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
    let c: RungClimb = {
      index: 0,
      tempoPct: 100,
      passesAtTempo: 0,
      failsAtTempo: 0,
    };
    let r = pass(c, 3);
    expect(r.change).toBe('none');
    r = pass(r.climb, 3);
    expect(r.change).toBe('advance');
    expect(r.climb.index).toBe(1);
    expect(r.climb.tempoPct).toBe(90); // entry tempo of the new rung
  });

  it('holds at the top rung when already at full tempo', () => {
    let c: RungClimb = {
      index: 2,
      tempoPct: 100,
      passesAtTempo: 1,
      failsAtTempo: 0,
    };
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

  it('never steps back a rung — slows to the floor and holds there', () => {
    // From 90: fail-runs slow 90 → 80 → 70 → 60 (min), then hold. Rung unchanged.
    let c = initRungClimb(2, OPTS);
    let r = fail(fail(c, 3).climb, 3); // → 80
    expect(r.climb.tempoPct).toBe(80);
    expect(r.change).toBe('slow-down');
    r = fail(fail(r.climb, 3).climb, 3); // → 70
    expect(r.climb.tempoPct).toBe(70);
    r = fail(fail(r.climb, 3).climb, 3); // → 60 (min)
    expect(r.climb.tempoPct).toBe(60);
    expect(r.change).toBe('slow-down');
    // Further failing runs hold at the floor; rung never changes.
    r = fail(fail(r.climb, 3).climb, 3);
    expect(r.change).toBe('none');
    expect(r.climb.tempoPct).toBe(60);
    expect(r.climb.index).toBe(2);
  });

  it('climbs the tempo back up from the floor once passes resume', () => {
    let c: RungClimb = {
      index: 2,
      tempoPct: 60,
      passesAtTempo: 0,
      failsAtTempo: 0,
    };
    let r = pass(pass(c, 3).climb, 3); // → 70
    expect(r.change).toBe('speed-up');
    expect(r.climb.tempoPct).toBe(70);
    expect(r.climb.index).toBe(2);
  });
});
