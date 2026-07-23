/**
 * Exact rational arithmetic (bigint numerator/denominator) for the Onyx
 * drum-reduction port.
 *
 * Onyx's `onyx_reduce.py` operates entirely in exact rational "beats"
 * (Python `Fraction`, = tick / ticksPerBeat). Its module docstring stresses
 * "no epsilon: beats are always exact rationals" — comparisons like
 * `frac == 0` after `properFraction`, and `is_aligned`'s `q.denominator == 1`
 * check, are only correct because the arithmetic never touches floating
 * point. A TS port using JS `number` (float64) would silently reintroduce
 * exactly the imprecision `Fraction` avoids, so beat-space math must go
 * through this type instead.
 *
 * Values are always kept in lowest terms with a positive denominator, so two
 * equal rationals are structurally equal and `compare` is exact.
 */

// `0n`/`1n` literals require target >= ES2020; this project targets ES2015,
// so bigint constants are built via `BigInt()` instead.
const B0 = BigInt(0);
const B1 = BigInt(1);

function gcd(a: bigint, b: bigint): bigint {
  a = a < B0 ? -a : a;
  b = b < B0 ? -b : b;
  while (b !== B0) {
    [a, b] = [b, a % b];
  }
  return a;
}

export class Rational {
  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    this.num = num;
    this.den = den;
  }

  /** Build a reduced rational from any integer/bigint numerator & denominator. */
  static of(num: bigint | number, den: bigint | number = 1): Rational {
    let n = typeof num === 'bigint' ? num : BigInt(num);
    let d = typeof den === 'bigint' ? den : BigInt(den);
    if (d === B0) {
      throw new Error('Rational: zero denominator');
    }
    if (d < B0) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || B1;
    return new Rational(n / g, d / g);
  }

  /** A beat position: `tick / ticksPerBeat`, exact. */
  static fromTick(tick: number, ticksPerBeat: number): Rational {
    return Rational.of(tick, ticksPerBeat);
  }

  static readonly ZERO = Rational.of(0, 1);
  static readonly ONE = Rational.of(1, 1);

  /** The greater of two rationals. */
  static max(a: Rational, b: Rational): Rational {
    return a.compare(b) >= 0 ? a : b;
  }

  add(o: Rational): Rational {
    return Rational.of(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(o: Rational): Rational {
    return Rational.of(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  mul(o: Rational): Rational {
    return Rational.of(this.num * o.num, this.den * o.den);
  }

  /** Multiply by a plain integer — Onyx scales beats by small integers often. */
  mulInt(k: bigint | number): Rational {
    const kk = typeof k === 'bigint' ? k : BigInt(k);
    return Rational.of(this.num * kk, this.den);
  }

  div(o: Rational): Rational {
    if (o.num === B0) {
      throw new Error('Rational: division by zero');
    }
    return Rational.of(this.num * o.den, this.den * o.num);
  }

  /** -1 / 0 / +1 for this < / == / > `o`. */
  compare(o: Rational): number {
    const lhs = this.num * o.den;
    const rhs = o.num * this.den;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }

  eq(o: Rational): boolean {
    return this.num === o.num && this.den === o.den;
  }
  lt(o: Rational): boolean {
    return this.compare(o) < 0;
  }
  lte(o: Rational): boolean {
    return this.compare(o) <= 0;
  }
  gt(o: Rational): boolean {
    return this.compare(o) > 0;
  }
  gte(o: Rational): boolean {
    return this.compare(o) >= 0;
  }

  /** True when the value is a whole number — Onyx's `is_aligned` test. */
  isInteger(): boolean {
    return this.den === B1;
  }

  sign(): number {
    return this.num < B0 ? -1 : this.num > B0 ? 1 : 0;
  }

  /**
   * Lossy conversion to a float — for display / ms only. Never use the
   * result back in beat-space comparisons (that is the whole point of this
   * type). Kept for logging and for feeding tick positions to non-parity
   * code paths.
   */
  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }

  toString(): string {
    return this.den === B1 ? `${this.num}` : `${this.num}/${this.den}`;
  }
}
