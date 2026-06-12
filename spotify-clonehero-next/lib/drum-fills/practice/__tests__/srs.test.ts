import {
  initFillSrsState,
  applyAttempt,
  isDue,
  buildTodayQueue,
  FillWithState,
  FillSrsState,
  DEFAULT_SRS_OPTIONS,
} from '../srs';

const NOW = new Date('2026-06-12T12:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pass(tempoPct = 100) {
  return {passed: true, tempoPct};
}
function fail(tempoPct = 100) {
  return {passed: false, tempoPct};
}

describe('initFillSrsState', () => {
  it('starts new with no due date', () => {
    const s = initFillSrsState('f1');
    expect(s.state).toBe('new');
    expect(s.dueAt).toBeNull();
    expect(s.passStreak).toBe(0);
    expect(s.ease).toBe(DEFAULT_SRS_OPTIONS.startingEase);
  });
});

describe('applyAttempt — learning track', () => {
  it('new + pass -> learning, streak 1', () => {
    const s = applyAttempt(initFillSrsState('f1'), pass(), NOW);
    expect(s.state).toBe('learning');
    expect(s.passStreak).toBe(1);
    expect(s.totalAttempts).toBe(1);
  });

  it('new + fail stays new with reset streak', () => {
    const s = applyAttempt(initFillSrsState('f1'), fail(), NOW);
    expect(s.state).toBe('new');
    expect(s.passStreak).toBe(0);
  });

  it('promotes to mastered after masteryStreak passes at full tempo', () => {
    let s = initFillSrsState('f1');
    s = applyAttempt(s, pass(100), NOW);
    s = applyAttempt(s, pass(100), NOW);
    expect(s.state).toBe('learning');
    s = applyAttempt(s, pass(100), NOW);
    expect(s.state).toBe('mastered');
    expect(s.intervalDays).toBe(DEFAULT_SRS_OPTIONS.firstIntervalDays);
    expect(s.dueAt).toEqual(
      new Date(
        NOW.getTime() + DEFAULT_SRS_OPTIONS.firstIntervalDays * MS_PER_DAY,
      ),
    );
    expect(s.passStreak).toBe(0);
  });

  it('passes below mastery tempo do not build the mastery streak', () => {
    let s = initFillSrsState('f1');
    s = applyAttempt(s, pass(80), NOW);
    s = applyAttempt(s, pass(80), NOW);
    s = applyAttempt(s, pass(80), NOW);
    expect(s.state).toBe('learning');
    expect(s.passStreak).toBe(0);
  });

  it('a slow pass resets the streak mid-run', () => {
    let s = initFillSrsState('f1');
    s = applyAttempt(s, pass(100), NOW);
    s = applyAttempt(s, pass(80), NOW); // resets
    expect(s.passStreak).toBe(0);
    expect(s.state).toBe('learning');
  });

  it('does not mutate the input state', () => {
    const orig = initFillSrsState('f1');
    const snapshot = {...orig};
    applyAttempt(orig, pass(), NOW);
    expect(orig).toEqual(snapshot);
  });
});

describe('applyAttempt — review track', () => {
  function mastered(overrides: Partial<FillSrsState> = {}): FillSrsState {
    return {
      ...initFillSrsState('f1'),
      state: 'mastered',
      intervalDays: 1,
      dueAt: new Date(NOW.getTime() - MS_PER_DAY),
      passStreak: 0,
      ...overrides,
    };
  }

  it('successful first review grows to secondIntervalDays', () => {
    const s = applyAttempt(mastered({intervalDays: 1}), pass(), NOW);
    expect(s.state).toBe('mastered');
    expect(s.intervalDays).toBe(DEFAULT_SRS_OPTIONS.secondIntervalDays);
    expect(s.dueAt).toEqual(
      new Date(
        NOW.getTime() + DEFAULT_SRS_OPTIONS.secondIntervalDays * MS_PER_DAY,
      ),
    );
    expect(s.passStreak).toBe(1);
  });

  it('subsequent successful review multiplies by ease', () => {
    const s = applyAttempt(mastered({intervalDays: 3, ease: 2.5}), pass(), NOW);
    expect(s.intervalDays).toBeCloseTo(7.5);
  });

  it('failing a due review demotes to learning, shrinks interval and ease', () => {
    const s = applyAttempt(
      mastered({intervalDays: 10, ease: 2.5}),
      fail(),
      NOW,
    );
    expect(s.state).toBe('learning');
    expect(s.intervalDays).toBe(5); // 10 * 0.5
    expect(s.ease).toBeCloseTo(2.3); // 2.5 - 0.2
    expect(s.passStreak).toBe(0);
    expect(s.dueAt).toEqual(new Date(NOW.getTime() + 5 * MS_PER_DAY));
  });

  it('lapse interval never drops below minIntervalDays; ease floored', () => {
    const s = applyAttempt(
      mastered({intervalDays: 1, ease: DEFAULT_SRS_OPTIONS.minEase}),
      fail(),
      NOW,
    );
    expect(s.intervalDays).toBe(DEFAULT_SRS_OPTIONS.minIntervalDays);
    expect(s.ease).toBe(DEFAULT_SRS_OPTIONS.minEase);
  });
});

describe('isDue', () => {
  it('only mastered fills with past dueAt are due', () => {
    const past = new Date(NOW.getTime() - 1000);
    const future = new Date(NOW.getTime() + 1000);
    expect(
      isDue({...initFillSrsState('a'), state: 'mastered', dueAt: past}, NOW),
    ).toBe(true);
    expect(
      isDue({...initFillSrsState('a'), state: 'mastered', dueAt: future}, NOW),
    ).toBe(false);
    expect(isDue(initFillSrsState('a'), NOW)).toBe(false);
  });
});

describe('buildTodayQueue', () => {
  function fill(
    id: string,
    subdivision: string,
    voicing: string,
    srs: Partial<FillSrsState> = {},
  ): FillWithState {
    return {
      fillId: id,
      taxonomy: {subdivision, voicing},
      srs: {...initFillSrsState(id), ...srs},
    };
  }

  it('puts due reviews first, most overdue first', () => {
    const fills: FillWithState[] = [
      fill('r1', '8ths', 'toms', {
        state: 'mastered',
        dueAt: new Date(NOW.getTime() - MS_PER_DAY),
      }),
      fill('r2', '16ths', 'snare', {
        state: 'mastered',
        dueAt: new Date(NOW.getTime() - 3 * MS_PER_DAY),
      }),
      fill('n1', '8ths', 'toms'),
    ];
    const queue = buildTodayQueue(fills, NOW);
    expect(queue[0]).toEqual({fillId: 'r2', reason: 'review'});
    expect(queue[1]).toEqual({fillId: 'r1', reason: 'review'});
    expect(queue.find(q => q.fillId === 'n1')?.reason).toBe('new');
  });

  it('selects new fills for taxonomy diversity', () => {
    // Two 8ths/toms, one 16ths/snare new fills; pick the diverse one before a dup.
    const fills: FillWithState[] = [
      fill('a', '8ths', 'toms'),
      fill('b', '8ths', 'toms'),
      fill('c', '16ths', 'snare'),
    ];
    const queue = buildTodayQueue(fills, NOW, {maxNewFills: 2});
    const ids = queue.map(q => q.fillId);
    // First two picks should cover both distinct categories.
    expect(ids).toContain('c');
    expect(ids.length).toBe(2);
    const cats = new Set(
      queue.map(
        q => fills.find(f => f.fillId === q.fillId)!.taxonomy.subdivision,
      ),
    );
    expect(cats.has('8ths')).toBe(true);
    expect(cats.has('16ths')).toBe(true);
  });

  it('respects maxItems and maxNewFills', () => {
    const fills: FillWithState[] = Array.from({length: 10}, (_, i) =>
      fill(`n${i}`, '8ths', 'toms'),
    );
    const queue = buildTodayQueue(fills, NOW, {maxItems: 4, maxNewFills: 3});
    expect(queue.length).toBe(3); // capped by maxNewFills
    expect(queue.every(q => q.reason === 'new')).toBe(true);
  });

  it('biases new picks toward categories least covered by existing practice', () => {
    const fills: FillWithState[] = [
      // Already-practiced (learning) 8ths fills make 8ths well-covered.
      fill('p1', '8ths', 'toms', {state: 'learning'}),
      fill('p2', '8ths', 'toms', {state: 'learning'}),
      // New candidates: a 16ths one should be preferred over another 8ths.
      fill('new8', '8ths', 'toms'),
      fill('new16', '16ths', 'crash'),
    ];
    const queue = buildTodayQueue(fills, NOW, {maxNewFills: 1});
    expect(queue).toEqual([{fillId: 'new16', reason: 'new'}]);
  });
});
