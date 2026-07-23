import {Rational} from '../rational';

describe('Rational', () => {
  test('reduces to lowest terms with positive denominator', () => {
    expect(Rational.of(2, 4).eq(Rational.of(1, 2))).toBe(true);
    const neg = Rational.of(1, -2);
    expect(neg.num).toBe(BigInt(-1));
    expect(neg.den).toBe(BigInt(2));
    expect(neg.toString()).toBe('-1/2');
    expect(Rational.of(0, 5).eq(Rational.ZERO)).toBe(true);
  });

  test('fromTick is exact tick/ticksPerBeat', () => {
    expect(Rational.fromTick(240, 480).eq(Rational.of(1, 2))).toBe(true);
    expect(Rational.fromTick(480, 480).eq(Rational.ONE)).toBe(true);
    expect(Rational.fromTick(64, 192).eq(Rational.of(1, 3))).toBe(true);
  });

  test('add / sub / mul / div are exact', () => {
    expect(Rational.of(1, 2).add(Rational.of(1, 3)).eq(Rational.of(5, 6))).toBe(
      true,
    );
    expect(Rational.of(5, 6).sub(Rational.of(1, 2)).eq(Rational.of(1, 3))).toBe(
      true,
    );
    expect(Rational.of(2, 3).mul(Rational.of(3, 4)).eq(Rational.of(1, 2))).toBe(
      true,
    );
    expect(Rational.of(1, 2).div(Rational.of(1, 4)).eq(Rational.of(2))).toBe(
      true,
    );
    expect(Rational.of(1, 2).mulInt(4).eq(Rational.of(2))).toBe(true);
  });

  test('division by zero throws', () => {
    expect(() => Rational.of(1, 2).div(Rational.ZERO)).toThrow();
    expect(() => Rational.of(1, 0)).toThrow();
  });

  test('compare / ordering helpers are total and exact', () => {
    const third = Rational.of(1, 3);
    const half = Rational.of(1, 2);
    expect(third.lt(half)).toBe(true);
    expect(half.gt(third)).toBe(true);
    expect(third.compare(third)).toBe(0);
    expect(half.lte(half)).toBe(true);
    expect(half.gte(third)).toBe(true);
  });

  test('isInteger models Onyx is_aligned (r / divn has denominator 1)', () => {
    // beats-within = 2, half-note grid (divn=2): 2/2 = 1 -> aligned.
    expect(Rational.of(2).div(Rational.of(2)).isInteger()).toBe(true);
    // beats-within = 1, half-note grid: 1/2 -> not aligned.
    expect(Rational.of(1).div(Rational.of(2)).isInteger()).toBe(false);
    // eighth-note grid (divn=1/2): (1/2) / (1/2) = 1 -> aligned.
    expect(Rational.of(1, 2).div(Rational.of(1, 2)).isInteger()).toBe(true);
    expect(Rational.of(1, 3).div(Rational.of(1, 2)).isInteger()).toBe(false);
  });

  test('stays exact across large bigint numerators (no float drift)', () => {
    // A position float64 could not represent exactly: 1/3 summed 3 times.
    const third = Rational.of(1, 3);
    expect(third.add(third).add(third).eq(Rational.ONE)).toBe(true);
    // Large tick against an odd resolution.
    const p = Rational.fromTick(1_000_000_001, 3);
    expect(p.mulInt(3).eq(Rational.of(1_000_000_001))).toBe(true);
  });

  test('sign', () => {
    expect(Rational.of(-3, 4).sign()).toBe(-1);
    expect(Rational.ZERO.sign()).toBe(0);
    expect(Rational.of(3, 4).sign()).toBe(1);
  });
});
