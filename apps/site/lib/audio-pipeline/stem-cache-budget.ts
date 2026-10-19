/**
 * How large the stem cache may grow.
 *
 * The budget counts cache bytes, not origin bytes. A target expressed as a
 * share of the quota is unreachable as soon as the chart projects alone
 * exceed it — the pruner would then empty the whole cache on every run and
 * still report failure. Origin pressure lowers the budget instead of
 * defining it.
 *
 * This is policy, kept apart from the cache mechanism so a test can prune a
 * few hundred bytes instead of fabricating a gigabyte, and so the numbers can
 * be argued about in one place.
 */

export interface StemCacheBudgets {
  /** What the cache may hold when the origin has room. */
  relaxedBytes: number;
  /** What it may hold when the origin is close to its quota. */
  underPressureBytes: number;
  /** Share of the origin quota at which the tighter budget applies. */
  pressureRatio: number;
}

/**
 * A full-song drums stem is ~90 MB gzipped and its vocals ~4 MB, so an entry
 * costs about 94 MB. The relaxed budget is therefore about 22 songs, and the
 * tight one about five — the song being worked on and a few before it, which
 * is what a user moving between two or three charts reuses.
 */
export const DEFAULT_STEM_CACHE_BUDGETS: StemCacheBudgets = {
  relaxedBytes: 2 * 1024 * 1024 * 1024,
  underPressureBytes: 512 * 1024 * 1024,
  pressureRatio: 0.7,
};

/**
 * The budget to prune to, given how full the origin is.
 *
 * A missing reading gives the relaxed budget. Deleting a user's separated
 * stems on a number nobody could read is the worse of the two mistakes.
 */
export function stemCacheBudgetBytes(
  pressure: {ratio: number} | null,
  budgets: StemCacheBudgets = DEFAULT_STEM_CACHE_BUDGETS,
): number {
  return pressure != null && pressure.ratio >= budgets.pressureRatio
    ? budgets.underPressureBytes
    : budgets.relaxedBytes;
}
