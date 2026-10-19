/**
 * Mastery state machine + SM-2-style spaced-repetition scheduler for drum fills.
 *
 * Per-fill lifecycle: `new → learning → mastered`.
 * - A fill starts `new`. Passing attempts in `learning` accumulate a streak;
 *   once the streak reaches {@link SrsOptions.masteryStreak} (intended to be hit
 *   while the speed trainer is at ≥100% tempo) the fill becomes `mastered` and
 *   enters the review schedule.
 * - `mastered` fills are reviewed on a growing interval (SM-2 style). Passing a
 *   due review grows the interval by `ease`; failing shrinks it and demotes the
 *   fill back to `learning`.
 *
 * All functions are pure: `(state, attemptResult, now) → newState`. Time is
 * passed in explicitly so behaviour is deterministic and testable.
 */

export type MasteryState = 'new' | 'learning' | 'mastered';

/** Per-fill scheduling/mastery state. Persisted to the `fill_srs` table. */
export type FillSrsState = {
  fillId: string;
  state: MasteryState;
  /** SM-2 ease factor; multiplies the interval on each successful review. */
  ease: number;
  /** Current review interval in days (0 until first mastered). */
  intervalDays: number;
  /** When the next review is due. null while still `new`/`learning`. */
  dueAt: Date | null;
  /** Consecutive passing attempts (resets on a fail). */
  passStreak: number;
  /** Total attempts logged against this fill. */
  totalAttempts: number;
};

/** Minimal result of a single practice attempt, as consumed by the scheduler. */
export type AttemptResult = {
  /** Did the attempt meet the pass threshold (see scoring.ts). */
  passed: boolean;
  /**
   * Tempo percentage the attempt was played at (100 = full speed). Mastery
   * promotion only counts passes at or above {@link SrsOptions.masteryTempoPct}.
   */
  tempoPct: number;
};

export type SrsOptions = {
  /** Passing streak required to promote learning → mastered. */
  masteryStreak: number;
  /** Minimum tempo % for a pass to count toward mastery promotion. */
  masteryTempoPct: number;
  /** Starting ease factor for a newly mastered fill. */
  startingEase: number;
  /** Lower bound on ease. */
  minEase: number;
  /** Ease decrement applied when a review is failed. */
  easePenalty: number;
  /** Interval (days) for the first review after mastery. */
  firstIntervalDays: number;
  /** Interval (days) for the second successful review. */
  secondIntervalDays: number;
  /** Factor applied to shrink the interval on a failed review. */
  lapseIntervalFactor: number;
  /** Minimum interval (days) after a lapse. */
  minIntervalDays: number;
};

export const DEFAULT_SRS_OPTIONS: SrsOptions = {
  masteryStreak: 3,
  masteryTempoPct: 100,
  startingEase: 2.5,
  minEase: 1.3,
  easePenalty: 0.2,
  firstIntervalDays: 1,
  secondIntervalDays: 3,
  lapseIntervalFactor: 0.5,
  minIntervalDays: 1,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Initial SRS state for a freshly detected fill. */
export function initFillSrsState(
  fillId: string,
  options: Partial<SrsOptions> = {},
): FillSrsState {
  const opts = {...DEFAULT_SRS_OPTIONS, ...options};
  return {
    fillId,
    state: 'new',
    ease: opts.startingEase,
    intervalDays: 0,
    dueAt: null,
    passStreak: 0,
    totalAttempts: 0,
  };
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

/**
 * Advance a fill's SRS state given the outcome of one practice attempt.
 *
 * Pure: returns a new state object, never mutates the input.
 */
export function applyAttempt(
  state: FillSrsState,
  attempt: AttemptResult,
  now: Date,
  options: Partial<SrsOptions> = {},
): FillSrsState {
  const opts: SrsOptions = {...DEFAULT_SRS_OPTIONS, ...options};
  const totalAttempts = state.totalAttempts + 1;

  // --- learning track (new / learning) ---
  if (state.state === 'new' || state.state === 'learning') {
    if (!attempt.passed) {
      return {
        ...state,
        state: state.state === 'new' ? 'new' : 'learning',
        passStreak: 0,
        totalAttempts,
      };
    }

    // A pass moves new → learning and grows the streak. Only passes at the
    // required tempo count toward mastery promotion.
    const countsForMastery = attempt.tempoPct >= opts.masteryTempoPct;
    const passStreak = countsForMastery ? state.passStreak + 1 : 0;

    if (countsForMastery && passStreak >= opts.masteryStreak) {
      // Promote to mastered; schedule the first review.
      return {
        ...state,
        state: 'mastered',
        ease: opts.startingEase,
        intervalDays: opts.firstIntervalDays,
        dueAt: addDays(now, opts.firstIntervalDays),
        passStreak: 0,
        totalAttempts,
      };
    }

    return {
      ...state,
      state: 'learning',
      passStreak,
      totalAttempts,
    };
  }

  // --- review track (mastered) ---
  if (!attempt.passed) {
    // Lapse: demote to learning, shrink interval, reduce ease.
    const intervalDays = Math.max(
      opts.minIntervalDays,
      state.intervalDays * opts.lapseIntervalFactor,
    );
    return {
      ...state,
      state: 'learning',
      ease: Math.max(opts.minEase, state.ease - opts.easePenalty),
      intervalDays,
      dueAt: addDays(now, intervalDays),
      passStreak: 0,
      totalAttempts,
    };
  }

  // Successful review: grow the interval.
  let intervalDays: number;
  if (state.intervalDays <= opts.firstIntervalDays) {
    intervalDays = opts.secondIntervalDays;
  } else {
    intervalDays = state.intervalDays * state.ease;
  }

  return {
    ...state,
    state: 'mastered',
    intervalDays,
    dueAt: addDays(now, intervalDays),
    passStreak: state.passStreak + 1,
    totalAttempts,
  };
}

/** Whether a fill is due for review at `now`. */
export function isDue(state: FillSrsState, now: Date): boolean {
  return (
    state.state === 'mastered' &&
    state.dueAt !== null &&
    state.dueAt.getTime() <= now.getTime()
  );
}

// ---------------------------------------------------------------------------
// Today queue
// ---------------------------------------------------------------------------

/**
 * Taxonomy categories used to spread new-fill selection across under-practiced
 * areas. Kept loose (strings) so it stays compatible with the detection
 * classifier without a hard dependency.
 */
export type FillTaxonomy = {
  subdivision: string;
  voicing: string;
};

/** A fill paired with its current SRS state, as fed to the queue builder. */
export type FillWithState = {
  fillId: string;
  taxonomy: FillTaxonomy;
  srs: FillSrsState;
};

export type TodayQueueOptions = {
  /** Max total items in the queue. */
  maxItems: number;
  /** Max brand-new fills to introduce in one session. */
  maxNewFills: number;
};

export const DEFAULT_TODAY_QUEUE_OPTIONS: TodayQueueOptions = {
  maxItems: 20,
  maxNewFills: 5,
};

export type TodayQueueItem = {
  fillId: string;
  /** Why this item is in the queue. */
  reason: 'review' | 'new';
};

/**
 * Build the "Today" practice queue.
 *
 * Order: all due reviews first (most overdue first), then new fills chosen to
 * maximise taxonomy diversity — each successive pick favours the subdivision and
 * voicing categories that are least represented so far (counting both already-
 * practiced fills and picks made earlier in this queue), so under-practiced
 * categories get covered.
 */
export function buildTodayQueue(
  fills: FillWithState[],
  now: Date,
  options: Partial<TodayQueueOptions> = {},
): TodayQueueItem[] {
  const opts: TodayQueueOptions = {...DEFAULT_TODAY_QUEUE_OPTIONS, ...options};

  // Due reviews, most overdue first.
  const dueReviews = fills
    .filter(f => isDue(f.srs, now))
    .sort((a, b) => {
      const aDue = a.srs.dueAt ? a.srs.dueAt.getTime() : 0;
      const bDue = b.srs.dueAt ? b.srs.dueAt.getTime() : 0;
      return aDue - bDue;
    });

  const queue: TodayQueueItem[] = [];
  for (const f of dueReviews) {
    if (queue.length >= opts.maxItems) break;
    queue.push({fillId: f.fillId, reason: 'review'});
  }

  // Seed category counts from fills the user has already engaged with
  // (anything past `new`), so diversity selection covers gaps in real practice.
  const subdivisionCounts = new Map<string, number>();
  const voicingCounts = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) =>
    m.set(k, (m.get(k) ?? 0) + 1);

  for (const f of fills) {
    if (f.srs.state !== 'new') {
      bump(subdivisionCounts, f.taxonomy.subdivision);
      bump(voicingCounts, f.taxonomy.voicing);
    }
  }

  const newCandidates = fills.filter(f => f.srs.state === 'new');
  const remainingNew = new Set(newCandidates.map(f => f.fillId));
  let newAdded = 0;

  while (
    newAdded < opts.maxNewFills &&
    queue.length < opts.maxItems &&
    remainingNew.size > 0
  ) {
    // Pick the candidate whose categories are currently least represented.
    let best: FillWithState | null = null;
    let bestScore = Infinity;
    for (const f of newCandidates) {
      if (!remainingNew.has(f.fillId)) continue;
      const score =
        (subdivisionCounts.get(f.taxonomy.subdivision) ?? 0) +
        (voicingCounts.get(f.taxonomy.voicing) ?? 0);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    if (!best) break;

    queue.push({fillId: best.fillId, reason: 'new'});
    remainingNew.delete(best.fillId);
    bump(subdivisionCounts, best.taxonomy.subdivision);
    bump(voicingCounts, best.taxonomy.voicing);
    newAdded++;
  }

  return queue;
}
