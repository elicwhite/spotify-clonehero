import {evaluateAttempt, matchResultToJudgments} from '../practice/attempt';
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
    const hits: TimedHit[] = [{msTime: 50, lane: 'red', isCymbal: false}];
    // Default good window is 75ms → matched as good.
    const loose = evaluateAttempt([notes[0]], hits);
    expect(loose.score.good).toBe(1);
    // Tighten to 30ms → out of range → miss.
    const tight = evaluateAttempt([notes[0]], hits, {
      windows: {perfect: 10, good: 30},
    });
    expect(tight.score.miss).toBe(1);
  });
});
