import {
  startingRungIndex,
  resolveRungIndex,
  initRungProgress,
  advanceLadder,
  type LadderRungLike,
} from '../fillLadder';

function rung(
  key: string,
  difficulty: number,
  state: LadderRungLike['state'] = 'new',
): LadderRungLike {
  return {fillSimilarityKey: key, difficultyScore: difficulty, state};
}

describe('startingRungIndex', () => {
  it('returns 0 for an empty ladder', () => {
    expect(startingRungIndex([])).toBe(0);
  });

  it('starts at the lowest unmastered rung', () => {
    const rungs = [
      rung('a', 10, 'mastered'),
      rung('b', 20, 'mastered'),
      rung('c', 30, 'new'),
      rung('d', 40, 'learning'),
    ];
    expect(startingRungIndex(rungs)).toBe(2);
  });

  it('returns the top rung when all are mastered', () => {
    const rungs = [rung('a', 10, 'mastered'), rung('b', 20, 'mastered')];
    expect(startingRungIndex(rungs)).toBe(1);
  });
});

describe('resolveRungIndex', () => {
  const rungs = [rung('a', 10), rung('b', 20), rung('c', 30)];

  it('resolves a saved key to its index', () => {
    expect(resolveRungIndex(rungs, 'b')).toBe(1);
  });

  it('falls back to the starting rung when the saved key is gone', () => {
    expect(resolveRungIndex(rungs, 'missing')).toBe(0);
  });

  it('falls back to the starting rung when nothing was saved', () => {
    const withMastered = [
      rung('a', 10, 'mastered'),
      rung('b', 20, 'new'),
      rung('c', 30, 'new'),
    ];
    expect(resolveRungIndex(withMastered, null)).toBe(1);
  });
});

describe('advanceLadder', () => {
  const opts = {passesToAdvance: 2, failsToStepBack: 3};

  it('advances after enough passes and resets the tally', () => {
    let p = initRungProgress(0);
    let r = advanceLadder(p, 3, true, opts);
    expect(r.moved).toBe(false);
    expect(r.progress.passes).toBe(1);
    p = r.progress;

    r = advanceLadder(p, 3, true, opts);
    expect(r.moved).toBe(true);
    expect(r.direction).toBe('advance');
    expect(r.progress.index).toBe(1);
    expect(r.progress.passes).toBe(0);
  });

  it('does not advance past the top rung', () => {
    const p = {index: 2, passes: 1, fails: 0};
    const r = advanceLadder(p, 3, true, opts);
    expect(r.moved).toBe(false);
    expect(r.progress.index).toBe(2);
    // still accumulates passes even when pinned at the top
    expect(r.progress.passes).toBe(2);
  });

  it('steps back after enough consecutive fails', () => {
    let p = initRungProgress(2);
    let r = advanceLadder(p, 3, false, opts);
    p = r.progress;
    expect(r.moved).toBe(false);
    r = advanceLadder(p, 3, false, opts);
    p = r.progress;
    expect(r.moved).toBe(false);
    expect(p.fails).toBe(2);

    r = advanceLadder(p, 3, false, opts);
    expect(r.moved).toBe(true);
    expect(r.direction).toBe('back');
    expect(r.progress.index).toBe(1);
    expect(r.progress.fails).toBe(0);
  });

  it('does not step back below the bottom rung', () => {
    const p = {index: 0, passes: 0, fails: 2};
    const r = advanceLadder(p, 3, false, opts);
    expect(r.moved).toBe(false);
    expect(r.progress.index).toBe(0);
  });

  it('a pass clears the fail streak', () => {
    let p = initRungProgress(1);
    p = advanceLadder(p, 3, false, opts).progress;
    p = advanceLadder(p, 3, false, opts).progress;
    expect(p.fails).toBe(2);
    p = advanceLadder(p, 3, true, opts).progress;
    expect(p.fails).toBe(0);
    expect(p.passes).toBe(1);
  });
});
