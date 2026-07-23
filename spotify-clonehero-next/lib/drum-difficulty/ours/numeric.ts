/**
 * Small numeric helpers shared by `featurize.ts` and `consistencyMetric.ts` —
 * Python-parity primitives (`bisect`, `round`, `statistics`-free `median`)
 * used by both the feature vector builder and the canonicalization pass.
 */

/** Python 3 `round` — round-half-to-even. Assumes `x >= 0` (every caller's
 * input — ms offsets, beat positions — is non-negative). */
export function pythonRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Python `bisect.bisect_left`. */
export function bisectLeft(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Python `bisect.bisect_right`. */
export function bisectRight(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < a[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Python `statistics`-free `numpy.median` on a numeric array (sorts a copy;
 * even length -> average of the two middle values). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
