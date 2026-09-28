import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {springs} from '../src/brand/tokens';
import {alpha, colorAt, mixColor, parseColor} from '../src/motion/color';
import {Easing} from 'remotion';
import {bezier, glide, inOutCubic} from '../src/motion/easing';
import {keyed, kf} from '../src/motion/keyframes';
import {velocity, wave} from '../src/motion/math';
import {mulberry32, rng} from '../src/motion/random';
import {lowerBound, sortedUnique} from '../src/motion/sorted';
import {quadToQuadMatrix3d, type Quad} from '../src/motion/quad';
import {
  settle,
  spring01,
  springAt,
  type SpringConfig,
} from '../src/motion/spring';
import {staggerIndex} from '../src/motion/stagger';

const close = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

describe('springs', () => {
  it('start at `from` and come to rest at `to`', () => {
    assert.equal(springAt(0, springs.pop), 0);
    close(springAt(5, springs.pop), 1);
    close(springAt(5, springs.soft, {from: 200, to: -40}), -40);
  });

  it('overshoot by the presets documented amounts', () => {
    const peak = (config: SpringConfig) => {
      let max = 0;
      for (let t = 0; t < 2; t += 1 / 2000)
        max = Math.max(max, springAt(t, config));
      return max - 1;
    };
    close(peak(springs.pop), 0.157, 0.002);
    close(peak(springs.hero), 0.086, 0.002);
    close(peak(springs.wobble), 0.227, 0.002);
  });

  it('handle critical and over-damping', () => {
    const critical = {damping: 2 * Math.sqrt(200), stiffness: 200, mass: 1};
    const over = {damping: 60, stiffness: 200, mass: 1};
    for (const config of [critical, over]) {
      let prev = 0;
      for (let f = 1; f < 120; f++) {
        const x = springAt(f / 60, config);
        assert.ok(x >= prev && x <= 1, 'moves toward 1 without overshoot');
        prev = x;
      }
    }
  });

  it('count frames at the given rate', () => {
    assert.equal(spring01(10, 10, springs.pop, 60), 0);
    close(spring01(40, 10, springs.pop, 60), springAt(0.5, springs.pop));
    close(spring01(25, 10, springs.pop, 30), springAt(0.5, springs.pop));
  });
});

describe('settle', () => {
  it('matches the presets settle times at 60 fps within 0.4%', () => {
    assert.equal(settle(springs.pop, 60, 0.004), 33);
    assert.equal(settle(springs.hero, 60, 0.004), 31);
    assert.equal(settle(springs.snap, 60, 0.004), 30);
    assert.equal(settle(springs.soft, 60, 0.004), 40);
    assert.equal(settle(springs.wobble, 60, 0.004), 46);
  });

  it('is the first frame after which the spring stays within tolerance', () => {
    for (const fps of [24, 30, 60]) {
      const f = settle(springs.wobble, fps, 0.01);
      assert.ok(Math.abs(springAt((f - 1) / fps, springs.wobble) - 1) > 0.01);
      for (let k = f; k < f + fps * 5; k++) {
        assert.ok(Math.abs(springAt(k / fps, springs.wobble) - 1) <= 0.01);
      }
    }
  });

  it('halves in frames at half the frame rate', () => {
    assert.ok(
      Math.abs(settle(springs.soft, 30) * 2 - settle(springs.soft, 60)) <= 2,
    );
  });

  it('settles critically and over-damped springs', () => {
    const critical = {damping: 2 * Math.sqrt(200), stiffness: 200, mass: 1};
    const f = settle(critical, 60, 0.005);
    assert.ok(Math.abs(springAt(f / 60, critical) - 1) <= 0.005);
    assert.ok(Math.abs(springAt((f - 1) / 60, critical) - 1) > 0.005);
    assert.ok(settle({damping: 80, stiffness: 200, mass: 1}, 60) > f);
  });

  it('refuses springs that never settle', () => {
    assert.throws(() => settle({damping: 0, stiffness: 200, mass: 1}, 60));
    assert.throws(() => settle(springs.pop, 60, 0));
  });
});

describe('bezier', () => {
  it("draws CSS's cubic-bezier, as Remotion's Easing.bezier does", () => {
    const curves: [number, number, number, number][] = [
      [0.16, 1, 0.3, 1],
      [0.7, 0, 0.84, 0],
      [0.83, 0, 0.17, 1],
      [0.42, 0, 0.12, 1],
      [0.5, -0.5, 0.5, 1.5],
      [0.99, 0, 0.01, 1],
    ];
    for (const c of curves) {
      const ours = bezier(...c);
      const theirs = Easing.bezier(...c);
      for (let t = 0; t <= 1; t += 1 / 64) close(ours(t), theirs(t), 1e-9);
    }
  });

  it('pins the ends and refuses x outside 0..1', () => {
    const e = bezier(0.3, 1.4, 0.6, 1);
    assert.equal(e(0), 0);
    assert.equal(e(1), 1);
    assert.throws(() => bezier(1.2, 0, 0.5, 1));
  });
});

describe('glide', () => {
  it('runs from 0 to 1 through the middle', () => {
    assert.equal(glide(0), 0);
    assert.equal(glide(1), 1);
    close(glide(0.5), 0.5);
  });

  it('never stops at either end', () => {
    // An in-out cubic starts and ends at rest; glide keeps `floor` of the average speed.
    const speed = (fn: (t: number) => number, t: number) =>
      velocity(fn, t, 1e-5);
    close(
      speed(t => inOutCubic(t), 0),
      0,
      1e-6,
    );
    close(
      speed(t => glide(t), 0),
      0.12,
      1e-4,
    );
    close(
      speed(t => glide(t), 1),
      0.12,
      1e-4,
    );
    close(
      speed(t => glide(t, 0.3), 0),
      0.3,
      1e-4,
    );
  });
});

describe('staggerIndex', () => {
  it('orders from either end, the centre or the edges', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4].map(i => staggerIndex(i, 5, 'end')),
      [4, 3, 2, 1, 0],
    );
    assert.deepEqual(
      [0, 1, 2, 3, 4].map(i => staggerIndex(i, 5, 'center')),
      [2, 1, 0, 1, 2],
    );
    assert.deepEqual(
      [0, 1, 2, 3, 4].map(i => staggerIndex(i, 5, 'edges')),
      [0, 1, 2, 1, 0],
    );
  });

  it('shuffles into distinct slots, the same on every call', () => {
    const slots = Array.from({length: 12}, (_, i) =>
      staggerIndex(i, 12, 'random', 'cards'),
    );
    assert.deepEqual(
      [...slots].sort((a, b) => a - b),
      Array.from({length: 12}, (_, i) => i),
    );
    assert.notDeepEqual(
      slots,
      Array.from({length: 12}, (_, i) => i),
    );
    assert.deepEqual(
      Array.from({length: 12}, (_, i) =>
        staggerIndex(i, 12, 'random', 'cards'),
      ),
      slots,
    );
  });
});

describe('kf', () => {
  it('holds outside the keys and eases between them', () => {
    const keys = [
      [10, 0],
      [20, 100, (t: number) => t],
    ] as const;
    assert.equal(kf(0, keys), 0);
    assert.equal(kf(15, keys), 50);
    assert.equal(kf(30, keys), 100);
    assert.equal(kf(5, []), 0);
  });
});

describe('keyed', () => {
  const lerp = (a: {x: number}, b: {x: number}, t: number) => ({
    x: a.x + (b.x - a.x) * t,
  });
  const keys = [
    {at: 10, value: {x: 0}},
    {at: 20, value: {x: 100}, ease: (t: number) => t},
    {at: 30, value: {x: 50}},
  ];

  it('holds the ends and mixes any value between keys', () => {
    assert.deepEqual(keyed(0, keys, lerp), {x: 0});
    assert.deepEqual(keyed(15, keys, lerp), {x: 50});
    assert.deepEqual(keyed(99, keys, lerp), {x: 50});
  });

  it('eases each move with its arriving key, else the default', () => {
    // 20 -> 30 has no easing of its own: the default in-out cubic.
    close(keyed(25, keys, lerp).x, 75);
    close(keyed(22.5, keys, lerp).x, 100 - 50 * inOutCubic(0.25));
    close(keyed(22.5, keys, lerp, t => t).x, 87.5);
  });

  it('agrees with kf on numbers', () => {
    const tuples = [
      [0, 1],
      [10, 5],
      [40, -3],
    ] as const;
    const objects = tuples.map(([at, value]) => ({at, value: value as number}));
    for (const f of [-5, 3, 10, 17.5, 39, 50]) {
      close(
        keyed(f, objects, (a, b, t) => a + (b - a) * t),
        kf(f, tuples),
      );
    }
  });

  it('needs a key', () => {
    assert.throws(() => keyed(0, [], lerp));
  });
});

describe('wave', () => {
  it('cycles once per period', () => {
    close(wave(0, 8), 0);
    close(wave(2, 8), 1);
    close(wave(6, 8), -1);
    close(wave(8, 8), 0);
    close(wave(0, 8, Math.PI / 2), 1);
  });
});

describe('sorted lists', () => {
  it('finds the first index at or above a value', () => {
    const xs = [1, 3, 3, 7];
    assert.deepEqual(
      [0, 1, 2, 3, 4, 8].map(x => lowerBound(xs, x)),
      [0, 0, 1, 1, 3, 4],
    );
  });

  it('sorts and dedupes', () => {
    assert.deepEqual(sortedUnique([5, 1, 5, 3, 1]), [1, 3, 5]);
  });
});

describe('seeded randomness', () => {
  it('repeats a sequence for a seed and differs across seeds', () => {
    const draw = (seed: number) => {
      const next = mulberry32(seed);
      return Array.from({length: 5}, next);
    };
    assert.deepEqual(draw(7), draw(7));
    assert.notDeepEqual(draw(7), draw(8));
    for (const v of draw(99)) assert.ok(v >= 0 && v < 1);
    assert.equal(rng('a').next(), rng('a').next());
  });
});

describe('quadToQuadMatrix3d', () => {
  /** An element's own corners, (0,0) (w,0) (w,h) (0,h). */
  const box = (width: number, height: number): Quad => [
    {x: 0, y: 0},
    {x: width, y: 0},
    {x: width, y: height},
    {x: 0, y: height},
  ];
  /** Where the CSS matrix3d sends a point of the element's own plane. */
  const apply = (css: string, x: number, y: number) => {
    const m = css.slice('matrix3d('.length, -1).split(',').map(Number);
    const at = (i: number) => m[i] as number;
    const w = at(3) * x + at(7) * y + at(15);
    return {
      x: (at(0) * x + at(4) * y + at(12)) / w,
      y: (at(1) * x + at(5) * y + at(13)) / w,
    };
  };

  it('maps each corner onto its target, in perspective', () => {
    const from = box(800, 400);
    // A floor seen in perspective: the far edge narrower than the near one.
    const to: Quad = [
      {x: 700, y: 300},
      {x: 1220, y: 300},
      {x: 1600, y: 900},
      {x: 320, y: 900},
    ];
    const css = quadToQuadMatrix3d(from, to);
    from.forEach((p, i) => {
      const q = apply(css, p.x, p.y);
      close(q.x, to[i]!.x, 1e-6);
      close(q.y, to[i]!.y, 1e-6);
    });
  });

  it('stays affine between parallelograms', () => {
    const from = box(100, 100);
    const to: Quad = [
      {x: 10, y: 10},
      {x: 210, y: 10},
      {x: 210, y: 110},
      {x: 10, y: 110},
    ];
    const css = quadToQuadMatrix3d(from, to);
    const mid = apply(css, 50, 50);
    close(mid.x, 110);
    close(mid.y, 60);
  });
});

describe('parseColor', () => {
  it('reads hex, rgb() and rgba()', () => {
    assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
    assert.deepEqual(parseColor('#ff000080'), [255, 0, 0, 128 / 255]);
    assert.deepEqual(parseColor('#0008'), [0, 0, 0, 136 / 255]);
    assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3, 1]);
    assert.deepEqual(
      parseColor('rgba(255,255,255,0.64)'),
      [255, 255, 255, 0.64],
    );
    assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), [10, 20, 30, 0.5]);
    assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  });

  it('throws on anything it cannot read', () => {
    for (const bad of [
      'red',
      'hsl(10 20% 30%)',
      '#12',
      '#ggg',
      'rgb(1, 2)',
      'rgba(1, 2, 3, 4, 5)',
      'rgb(a, b, c)',
      '',
    ]) {
      assert.throws(() => parseColor(bad), /cannot read/, bad);
    }
  });

  it('mixes and fades colours', () => {
    assert.equal(alpha('#e5484d', 0.5), 'rgba(229,72,77,0.5)');
    assert.equal(mixColor('#000000', '#ffffff', 0.5), 'rgba(128,128,128,1)');
    assert.equal(colorAt(100, [[0, '#000000']], 18), 'rgba(0,0,0,1)');
    assert.throws(() => colorAt(0, [], 18));
  });
});
