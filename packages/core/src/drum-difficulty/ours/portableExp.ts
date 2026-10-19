/**
 * Portable `exp()` — ported from `drum-reducer-reference`'s
 * `javascript/src/portable_exp.js` (itself mirroring
 * `python/drum_reducer/portable_exp.py` bit-for-bit, per that repo's
 * `DETERMINISM_CONTRACT.md` §3): the same fdlibm-style range-reduction +
 * degree-5 minimax polynomial, same constants, same operation order.
 *
 * `Math.exp` is not guaranteed bit-identical across JS engines (V8,
 * SpiderMonkey, JavaScriptCore each ship their own libm), so a reducer that
 * calls it directly could reduce the same chart slightly differently on
 * different users' browsers whenever a `survive_proba`/relane confidence
 * lands within a few ULP of a decode threshold. Pinning to one fixed,
 * portable algorithm removes that non-determinism.
 *
 * `scalbn`'s two-multiply split is a straight port too: `y * 2^k` never
 * materializes `2^k` in one shot (it would overflow for `k` near +/-1024
 * even though the true product is finite). This TS version builds `2^e`
 * from its IEEE-754 bit pattern via two `Uint32` writes instead of the
 * reference's `BigUint64` write — same exact result, no `bigint` dependency.
 */

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INVLN2 = 1.442695040888963387;
const HALF_LN2 = 3.46573590279972654709e-1; // 0.5 * ln2, the range-reduction cutoff

const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

const OVERFLOW = 7.09782712893383973096e2;
const UNDERFLOW = -7.4513321910194110842e2;
const TINY = Math.pow(2, -28);

const pow2Buf = new ArrayBuffer(8);
const pow2View = new DataView(pow2Buf);

/** `2^e` as an exact float64, for `-1022 <= e <= 1023` (normal double
 * range) — built directly from the IEEE-754 bit pattern (biased exponent,
 * zero mantissa), so the value is exact by construction. */
function pow2exact(e: number): number {
  const biased = (e + 1023) & 0x7ff;
  pow2View.setUint32(0, biased << 20, false);
  pow2View.setUint32(4, 0, false);
  return pow2View.getFloat64(0, false);
}

/** `y * 2^k`, matching `np.ldexp`: split `k` into two halves (each well
 * inside the normal exponent range for the `|x|` bounds this module ever
 * sees) and multiply twice, so no intermediate `2^k` overflows on its own. */
function scalbn(y: number, k: number): number {
  const k1 = Math.trunc(k / 2);
  const k2 = k - k1;
  return y * pow2exact(k1) * pow2exact(k2);
}

/** `exp(x)`, fdlibm-style. `x` and the return value are plain JS numbers
 * (float64). */
export function portableExp(x: number): number {
  if (x > OVERFLOW) return Infinity;
  if (x < UNDERFLOW) return 0.0;
  if (Math.abs(x) < TINY) return 1.0 + x;

  const needReduce = Math.abs(x) > HALF_LN2;
  let k = 0.0;
  if (needReduce) {
    k = x >= 0 ? Math.floor(INVLN2 * x + 0.5) : Math.ceil(INVLN2 * x - 0.5);
  }
  const hi = needReduce ? x - k * LN2_HI : x;
  const lo = needReduce ? k * LN2_LO : 0.0;
  const r = hi - lo;

  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  let y = 1.0 + ((r * c) / (2.0 - c) - lo + hi);
  y = scalbn(y, k);
  return y;
}

/** `1 / (1 + exp(-x))`, via {@link portableExp}. */
export function sigmoid(x: number): number {
  return 1.0 / (1.0 + portableExp(-x));
}

/**
 * Softmax over a row of raw scores: subtracts the row max first (exact
 * IEEE subtraction), then sums `portableExp(shifted)` in an explicit
 * ascending-index loop — never `Array.reduce`/divide-and-conquer, per the
 * reference's fixed-summation-order rule (`DETERMINISM_CONTRACT.md` §1).
 */
export function softmax(xs: readonly number[]): number[] {
  let m = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] > m) m = xs[i];
  }
  const exps = new Array<number>(xs.length);
  for (let i = 0; i < xs.length; i++) {
    exps[i] = portableExp(xs[i] - m);
  }
  let s = 0.0;
  for (let i = 0; i < xs.length; i++) {
    s += exps[i];
  }
  const out = new Array<number>(xs.length);
  for (let i = 0; i < xs.length; i++) {
    out[i] = exps[i] / s;
  }
  return out;
}
