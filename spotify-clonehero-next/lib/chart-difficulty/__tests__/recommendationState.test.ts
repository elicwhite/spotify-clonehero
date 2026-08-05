import {
  disagreementSeverity,
  resolveDifficultyRecommendation,
} from '../recommendationState';

const OLD = 'aaaaaaaabbbbbbbb';
const NEW = 'ccccccccdddddddd';

describe('resolveDifficultyRecommendation', () => {
  it('reports unavailable when there is no recommendation, whatever is stored', () => {
    const state = resolveDifficultyRecommendation({
      stored: 5,
      recommended: null,
    });
    expect(state.status).toBe('unavailable');
    expect(state.delta).toBeNull();
    expect(state.severity).toBe('none');
    expect(state.canApply).toBe(false);
  });

  it('reports unavailable even when the chart changed', () => {
    expect(
      resolveDifficultyRecommendation({
        stored: 5,
        recommended: null,
        sourceStampAtSet: OLD,
        currentSourceStamp: NEW,
      }).status,
    ).toBe('unavailable');
  });

  it('reports unset for a blank field with a recommendation', () => {
    const state = resolveDifficultyRecommendation({
      stored: null,
      recommended: 4,
    });
    expect(state.status).toBe('unset');
    expect(state.delta).toBeNull();
    expect(state.canApply).toBe(true);
  });

  it('reports agreement when the stored value matches', () => {
    const state = resolveDifficultyRecommendation({stored: 4, recommended: 4});
    expect(state.status).toBe('agrees');
    expect(state.delta).toBe(0);
    expect(state.severity).toBe('none');
    expect(state.canApply).toBe(false);
  });

  it('agreement wins over a changed chart', () => {
    const state = resolveDifficultyRecommendation({
      stored: 4,
      recommended: 4,
      sourceStampAtSet: OLD,
      currentSourceStamp: NEW,
    });
    expect(state.status).toBe('agrees');
    expect(state.chartChangedSinceSet).toBe(true);
  });

  it('grades disagreement by how far apart the two numbers are', () => {
    expect(
      resolveDifficultyRecommendation({stored: 4, recommended: 5}).severity,
    ).toBe('minor');
    expect(
      resolveDifficultyRecommendation({stored: 4, recommended: 6}).severity,
    ).toBe('moderate');
    expect(
      resolveDifficultyRecommendation({stored: 1, recommended: 5}).severity,
    ).toBe('major');
  });

  it('signs the delta so positive means we read the chart as harder', () => {
    expect(
      resolveDifficultyRecommendation({stored: 2, recommended: 5}).delta,
    ).toBe(3);
    expect(
      resolveDifficultyRecommendation({stored: 5, recommended: 2}).delta,
    ).toBe(-3);
  });

  it('reports staleness only when the chart changed and the numbers differ', () => {
    const stale = resolveDifficultyRecommendation({
      stored: 3,
      recommended: 5,
      sourceStampAtSet: OLD,
      currentSourceStamp: NEW,
    });
    expect(stale.status).toBe('stale');
    expect(stale.chartChangedSinceSet).toBe(true);
    expect(stale.canApply).toBe(true);

    const unchanged = resolveDifficultyRecommendation({
      stored: 3,
      recommended: 5,
      sourceStampAtSet: OLD,
      currentSourceStamp: OLD,
    });
    expect(unchanged.status).toBe('disagrees');
    expect(unchanged.chartChangedSinceSet).toBe(false);
  });

  it('treats unknown provenance as not stale', () => {
    expect(
      resolveDifficultyRecommendation({
        stored: 3,
        recommended: 5,
        currentSourceStamp: NEW,
      }).status,
    ).toBe('disagrees');
    expect(
      resolveDifficultyRecommendation({
        stored: 3,
        recommended: 5,
        sourceStampAtSet: OLD,
      }).status,
    ).toBe('disagrees');
  });
});

describe('disagreementSeverity', () => {
  it('buckets by absolute gap and reads a missing delta as none', () => {
    expect(disagreementSeverity(null)).toBe('none');
    expect(disagreementSeverity(0)).toBe('none');
    expect(disagreementSeverity(-1)).toBe('minor');
    expect(disagreementSeverity(2)).toBe('moderate');
    expect(disagreementSeverity(-6)).toBe('major');
  });
});
