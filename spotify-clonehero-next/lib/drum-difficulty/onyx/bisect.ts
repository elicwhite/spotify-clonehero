/**
 * Exact-rational analogues of Python's `bisect` module, used throughout the
 * Onyx port. Onyx's `onyx_reduce.py` leans on `bisect_left`/`bisect_right`/
 * `insort` over sorted `Fraction` lists; these mirror them over sorted
 * {@link Rational} arrays with identical tie semantics.
 */

import {Rational} from '../rational';

/** First index `i` with `arr[i] > x` (Python `bisect.bisect_right`). */
export function bisectRight(arr: Rational[], x: Rational): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x.lt(arr[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index `i` with `arr[i] >= x` (Python `bisect.bisect_left`). */
export function bisectLeft(arr: Rational[], x: Rational): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].lt(x)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Insert `x` keeping `arr` sorted, after equal elements (Python `insort`). */
export function insort(arr: Rational[], x: Rational): void {
  arr.splice(bisectRight(arr, x), 0, x);
}
