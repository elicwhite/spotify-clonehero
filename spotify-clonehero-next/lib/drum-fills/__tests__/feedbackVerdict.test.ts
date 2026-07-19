import {
  feedbackVerdict,
  DIALED_THRESHOLD_MS,
  type NoteTiming,
} from '../practice/feedbackVerdict';

// DIALED_THRESHOLD_MS is half the perfect window (50/2 = 25).
function notes(deltas: (number | null)[]): NoteTiming[] {
  return deltas.map(d => ({
    judgment: d == null ? 'miss' : Math.abs(d) <= 50 ? 'perfect' : 'good',
    deltaMs: d,
  }));
}

describe('feedbackVerdict', () => {
  it('exposes a threshold derived from the perfect window', () => {
    expect(DIALED_THRESHOLD_MS).toBe(25);
  });

  it('reads on-time within ±threshold as DIALED IN', () => {
    expect(feedbackVerdict(notes([0, 10, -10, 20]), 0).verdict).toBe('dialed');
    expect(feedbackVerdict(notes([25, -25, 25, -25]), 0).verdict).toBe(
      'dialed',
    );
  });

  it('reads a consistent early lean as RUSHING with a negative median', () => {
    const v = feedbackVerdict(notes([-40, -30, -50, -45]), 0);
    expect(v.verdict).toBe('rushing');
    expect(v.label).toBe('RUSHING');
    expect(v.medianMs).toBeLessThan(0);
  });

  it('reads a consistent late lean as DRAGGING with a positive median', () => {
    const v = feedbackVerdict(notes([35, 40, 30, 45]), 0);
    expect(v.verdict).toBe('dragging');
    expect(v.medianMs).toBeGreaterThan(0);
  });

  it('classifies the ±26ms boundary just outside dialed', () => {
    expect(feedbackVerdict(notes([26, 26, 26]), 0).verdict).toBe('dragging');
    expect(feedbackVerdict(notes([-26, -26, -26]), 0).verdict).toBe('rushing');
  });

  it('says KEEP GOING when at least half the notes are missed', () => {
    // 2 hits, 2 misses (4 total) → miss*2 >= total.
    const v = feedbackVerdict(notes([-5, 5, null, null]), 0);
    expect(v.verdict).toBe('keep-going');
    expect(v.missCount).toBe(2);
  });

  it('keeps the timing verdict when only a few notes miss', () => {
    // 5 hits early, 1 miss (6 total) → miss*2 < total, timing wins.
    const v = feedbackVerdict(notes([-40, -35, -45, -38, -42, null]), 0);
    expect(v.verdict).toBe('rushing');
    expect(v.missCount).toBe(1);
  });

  it('says KEEP GOING with a null median when nothing was hit', () => {
    const v = feedbackVerdict(notes([null, null, null]), 0);
    expect(v.verdict).toBe('keep-going');
    expect(v.medianMs).toBeNull();
  });

  it('passes through the extra count', () => {
    expect(feedbackVerdict(notes([0, 0]), 3).extraCount).toBe(3);
  });
});
