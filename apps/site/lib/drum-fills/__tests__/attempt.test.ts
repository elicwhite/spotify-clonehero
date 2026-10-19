import {
  bestFromScored,
  bestFromStored,
  evaluateAttempt,
  isHitWithinFill,
  isNewBest,
  isRealAttempt,
  matchResultToJudgments,
} from '../practice/attempt';
import {matchHits, type ExpectedNote, type TimedHit} from '../midi/hitMatcher';

const notes: ExpectedNote[] = [
  {id: 'n0', msTime: 0, lane: 'red', isCymbal: false},
  {id: 'n1', msTime: 250, lane: 'yellow', isCymbal: false},
  {id: 'n2', msTime: 500, lane: 'green', isCymbal: true},
];

describe('matchResultToJudgments', () => {
  it('maps matcher judgments + extras into the scorer shape', () => {
    const result = matchHits(notes, [
      {msTime: 5, lane: 'red', isCymbal: false},
      {msTime: 900, lane: 'blue', isCymbal: false}, // extra
    ]);
    const j = matchResultToJudgments(result);
    expect(j.notes).toHaveLength(3);
    expect(j.notes[0].quality).toBe('perfect');
    expect(j.notes[0].timingErrorMs).toBeCloseTo(5, 3);
    // n1 and n2 missed
    expect(j.notes[1].quality).toBe('miss');
    expect(j.notes[1].timingErrorMs).toBeUndefined();
    expect(j.extraHits).toHaveLength(1);
    expect(j.extraHits[0].lane).toBe('blue');
  });
});

describe('evaluateAttempt', () => {
  it('scores a perfect run at 100 and passes', () => {
    const hits: TimedHit[] = notes.map(n => ({
      msTime: n.msTime,
      lane: n.lane,
      isCymbal: n.isCymbal,
    }));
    const {score, match} = evaluateAttempt(notes, hits);
    expect(score.perfect).toBe(3);
    expect(score.miss).toBe(0);
    expect(score.score).toBe(100);
    expect(score.passed).toBe(true);
    expect(match.counts.perfect).toBe(3);
  });

  it('penalizes extra hits and misses', () => {
    const hits: TimedHit[] = [
      {msTime: 0, lane: 'red', isCymbal: false},
      {msTime: 10, lane: 'blue', isCymbal: false}, // extra
    ];
    const {score} = evaluateAttempt(notes, hits);
    expect(score.miss).toBe(2);
    expect(score.extraHits).toBe(1);
    expect(score.passed).toBe(false);
    expect(score.score).toBeLessThan(50);
  });

  it('respects custom timing windows', () => {
    const hits: TimedHit[] = [{msTime: 60, lane: 'red', isCymbal: false}];
    // Default windows: 60ms is inside ±70 (good) but outside ±50 (perfect).
    const loose = evaluateAttempt([notes[0]], hits);
    expect(loose.score.good).toBe(1);
    // Tighten to 30ms → out of range → miss.
    const tight = evaluateAttempt([notes[0]], hits, {
      windows: {perfect: 10, good: 30},
    });
    expect(tight.score.miss).toBe(1);
  });
});

describe('best attempt summaries', () => {
  it('bestFromScored carries counts + per-note judgments keyed by id', () => {
    const result = evaluateAttempt(notes, [
      {msTime: 0, lane: 'red', isCymbal: false}, // n0 perfect
      {msTime: 250, lane: 'yellow', isCymbal: false}, // n1 perfect
      {msTime: 900, lane: 'blue', isCymbal: false}, // extra; n2 missed
    ]);
    const best = bestFromScored(result);
    expect(best.score).toBe(result.score.score);
    expect(best.perfect).toBe(2);
    expect(best.miss).toBe(1);
    expect(best.extra).toBe(1);
    expect(best.judgments.get('n0')!.judgment).toBe('perfect');
    expect(best.judgments.get('n2')!.judgment).toBe('miss');
    expect(best.judgments.get('n2')!.deltaMs).toBeNull();
  });

  it('bestFromStored recomputes counts; extras unknown (null)', () => {
    const best = bestFromStored(82, [
      {id: '0:red:p', judgment: 'perfect', deltaMs: 4},
      {id: '0:yellow:p', judgment: 'good', deltaMs: -40},
      {id: '0:blue:c', judgment: 'miss', deltaMs: null},
    ]);
    expect(best.score).toBe(82);
    expect(best.perfect).toBe(1);
    expect(best.good).toBe(1);
    expect(best.miss).toBe(1);
    expect(best.extra).toBeNull();
    expect(best.judgments.get('0:yellow:p')!.deltaMs).toBe(-40);
  });

  it('isNewBest: any candidate beats null; ties count as a new best', () => {
    expect(isNewBest(null, 0)).toBe(true);
    const cur = bestFromStored(90, []);
    expect(isNewBest(cur, 91)).toBe(true);
    expect(isNewBest(cur, 90)).toBe(true); // tie → re-mark
    expect(isNewBest(cur, 89)).toBe(false);
  });
});

describe('isHitWithinFill', () => {
  // fill spans 0..1000ms, ±70ms window.
  it('keeps hits inside the note span', () => {
    expect(isHitWithinFill(0, 1000, 70)).toBe(true);
    expect(isHitWithinFill(500, 1000, 70)).toBe(true);
    expect(isHitWithinFill(1000, 1000, 70)).toBe(true);
  });

  it('keeps hits within one window before the first / after the last note', () => {
    expect(isHitWithinFill(-70, 1000, 70)).toBe(true);
    expect(isHitWithinFill(1070, 1000, 70)).toBe(true);
  });

  it('drops the post-fill resolution (a kick/crash well after the last note)', () => {
    expect(isHitWithinFill(1170, 1000, 70)).toBe(false); // +170ms after last note
    expect(isHitWithinFill(-90, 1000, 70)).toBe(false); // too early
  });
});

describe('isRealAttempt', () => {
  it('is false when no drum was hit (idle pass)', () => {
    expect(isRealAttempt(0, 12)).toBe(false);
  });

  it('is true once any drum is hit', () => {
    expect(isRealAttempt(1, 12)).toBe(true);
    expect(isRealAttempt(20, 12)).toBe(true);
  });

  it('is false when the fill has no notes regardless of hits', () => {
    expect(isRealAttempt(0, 0)).toBe(false);
    expect(isRealAttempt(5, 0)).toBe(false);
  });
});
