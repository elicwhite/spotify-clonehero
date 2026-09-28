/**
 * Extremes of lists of any length. Spreading a long list into Math.max or
 * Math.min passes every element as an argument and overflows the call stack
 * on large inputs (a chart with very many notes, say).
 */

/** The largest of `start` and every value. */
export function maxOf(values: Iterable<number>, start = -Infinity): number {
  let m = start;
  for (const v of values) if (v > m) m = v;
  return m;
}

/** The smallest of `start` and every value. */
export function minOf(values: Iterable<number>, start = Infinity): number {
  let m = start;
  for (const v of values) if (v < m) m = v;
  return m;
}
