/**
 * Sorted number lists: event frames, hit times. Pure.
 */

/** First index i with arr[i] >= x (arr sorted ascending). */
export const lowerBound = (arr: readonly number[], x: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((arr[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** The values ascending, each once. */
export const sortedUnique = (values: readonly number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);
