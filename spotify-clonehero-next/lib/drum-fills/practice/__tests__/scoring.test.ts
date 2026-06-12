import {
  scoreAttempt,
  AttemptJudgments,
  DEFAULT_SCORING_OPTIONS,
} from '../scoring';

function note(
  quality: 'perfect' | 'good' | 'miss',
  timingErrorMs?: number,
): AttemptJudgments['notes'][number] {
  return {quality, timingErrorMs};
}

describe('scoreAttempt', () => {
  it('scores an all-perfect attempt as 100 and passes', () => {
    const j: AttemptJudgments = {
      notes: [note('perfect', 5), note('perfect', -3), note('perfect', 0)],
      extraHits: [],
    };
    const result = scoreAttempt(j);
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.perfect).toBe(3);
    expect(result.miss).toBe(0);
  });

  it('counts good notes at reduced credit', () => {
    const j: AttemptJudgments = {
      notes: [note('good', 50), note('good', -40)],
      extraHits: [],
    };
    const result = scoreAttempt(j);
    // 2 * 0.7 / 2 = 0.7 -> 70
    expect(result.score).toBeCloseTo(70);
    expect(result.passed).toBe(false);
    expect(result.good).toBe(2);
  });

  it('penalizes misses', () => {
    const j: AttemptJudgments = {
      notes: [note('perfect', 0), note('perfect', 0), note('miss')],
      extraHits: [],
    };
    const result = scoreAttempt(j);
    // 2 / 3 -> 66.67
    expect(result.score).toBeCloseTo((2 / 3) * 100);
    expect(result.miss).toBe(1);
  });

  it('penalizes extra hits and clamps at 0', () => {
    const j: AttemptJudgments = {
      notes: [note('perfect', 0)],
      extraHits: [{lane: 'red'}, {lane: 'red'}, {lane: 'kick'}],
    };
    // earned 1, penalty 3*0.5=1.5 -> (1-1.5)/1 = -0.5 -> clamp 0
    const result = scoreAttempt(j);
    expect(result.score).toBe(0);
    expect(result.extraHits).toBe(3);
  });

  it('pass threshold is 90 by default', () => {
    expect(DEFAULT_SCORING_OPTIONS.passThreshold).toBe(90);
    // 9 perfect + 1 good of 10 notes -> (9 + 0.7)/10 = 0.97 -> 97 passes
    const notes = [
      ...Array.from({length: 9}, () => note('perfect', 0)),
      note('good', 60),
    ];
    const result = scoreAttempt({notes, extraHits: []});
    expect(result.score).toBeCloseTo(97);
    expect(result.passed).toBe(true);

    // 8 perfect + 2 miss -> 80 fails
    const notes2 = [
      ...Array.from({length: 8}, () => note('perfect', 0)),
      note('miss'),
      note('miss'),
    ];
    const result2 = scoreAttempt({notes: notes2, extraHits: []});
    expect(result2.score).toBeCloseTo(80);
    expect(result2.passed).toBe(false);
  });

  it('empty fill: clean attempt passes, extra hits fail', () => {
    expect(scoreAttempt({notes: [], extraHits: []}).score).toBe(100);
    expect(scoreAttempt({notes: [], extraHits: [{lane: 'red'}]}).score).toBe(0);
  });

  it('computes mean absolute timing error over non-miss notes', () => {
    const j: AttemptJudgments = {
      notes: [note('perfect', 10), note('good', -30), note('miss')],
      extraHits: [],
    };
    const result = scoreAttempt(j);
    expect(result.meanAbsTimingErrorMs).toBeCloseTo((10 + 30) / 2);
  });

  it('respects custom pass threshold and weights', () => {
    const j: AttemptJudgments = {
      notes: [note('good', 0), note('good', 0)],
      extraHits: [],
    };
    const result = scoreAttempt(j, {goodCredit: 1, passThreshold: 100});
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
  });
});
