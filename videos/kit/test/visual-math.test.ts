import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {layoutOf} from '../src/brand/layout';
import {
  assertStingMeta,
  stingMetaProblems,
  type StingMeta,
} from '../src/brand/stingMeta';
import {formatOf} from '../src/format/format';
import {shakeOverscan} from '../src/fx/CameraShake';
import {floatXY, punch} from '../src/fx/drift';
import {particleField, type ParticleFieldOptions} from '../src/fx/particles';
import {linear} from '../src/motion/easing';
import {cursorAt, cursorVisibility} from '../src/ui/cursor';
import {clipPeaks, peakMax, waveformBars} from '../src/ui/Waveform';

const close = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

describe('cursor paths', () => {
  const path = [
    {at: 10, x: 0, y: 0},
    {at: 30, x: 100, y: 0},
  ];

  it('wait at the first key and rest at the last', () => {
    assert.deepEqual(cursorAt(path, 0), {x: 0, y: 0});
    assert.deepEqual(cursorAt(path, 99), {x: 100, y: 0});
  });

  it('bulge sideways by the arc, and run straight without one', () => {
    const mid = cursorAt(path, 20);
    assert.ok(Math.abs(mid.y) > 1);
    const straight = cursorAt(
      [
        path[0] as (typeof path)[number],
        {...(path[1] as (typeof path)[number]), arc: 0, ease: linear},
      ],
      20,
    );
    close(straight.x, 50);
    close(straight.y, 0);
  });

  it('show inside their windows only', () => {
    const windows = [{appearAt: 10, hideAt: 40}, {appearAt: 100}];
    assert.equal(cursorVisibility(undefined, 5, 60), 1);
    assert.equal(cursorVisibility(windows, 5, 60), 0);
    close(cursorVisibility(windows, 35, 60), 1);
    assert.equal(cursorVisibility(windows, 60, 60), 0);
    close(cursorVisibility(windows, 200, 60), 1);
  });
});

describe('camera shake overscan', () => {
  const covers = (w: number, h: number, x: number, y: number, deg: number) => {
    const s = shakeOverscan(w, h, x, y, deg);
    const r = (deg * Math.PI) / 180;
    // Every frame corner, taken back through the layer's move, lies inside the layer.
    for (const [cx, cy] of [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ] as const) {
      const dx = cx - x;
      const dy = cy - y;
      const lx = (dx * Math.cos(r) + dy * Math.sin(r)) / s;
      const ly = (-dx * Math.sin(r) + dy * Math.cos(r)) / s;
      assert.ok(Math.abs(lx) <= w / 2 + 1e-6 && Math.abs(ly) <= h / 2 + 1e-6);
    }
  };

  it('is 1 at rest', () => assert.equal(shakeOverscan(1920, 1080, 0, 0, 0), 1));

  it('covers the frame in any format', () => {
    covers(1920, 1080, 14, -9, 0.5);
    covers(1080, 1920, -14, 9, -0.5);
    covers(3840, 2160, 28, 18, 1.2);
  });
});

describe('drift', () => {
  const at60 = {fps: 60, unit: 1};

  it('floats within its ellipse, the same at any fps', () => {
    for (let f = 0; f < 600; f += 7) {
      const p = floatXY(f, at60, {seed: 'x'});
      assert.ok(Math.abs(p.x) <= 8 && Math.abs(p.y) <= 5);
    }
    const a = floatXY(120, at60, {seed: 3});
    const b = floatXY(60, {fps: 30, unit: 1}, {seed: 3});
    close(a.x, b.x);
    close(a.y, b.y);
  });

  it('floats in reference px, scaled to the format', () => {
    const a = floatXY(200, at60, {seed: 'y'});
    const b = floatXY(200, {fps: 60, unit: 2}, {seed: 'y'});
    close(b.x, 2 * a.x);
    close(b.y, 2 * a.y);
  });

  it('punches in once per listed frame', () => {
    assert.equal(punch(5, [10, 20], 60), 1);
    close(punch(15, [10, 20], 60), 1.018, 1e-4);
    close(punch(60, [10, 20], 60), 1.036, 1e-4);
  });
});

describe('waveform peaks', () => {
  const peaks = [0.1, 0.5, 0.9, 0.3, 0.2, 0.8];

  it('clips to a window and finds its loudest bin', () => {
    assert.deepEqual(clipPeaks(peaks, 2, 1, 2), [0, 0, 0.9, 0.3, 0, 0]);
    assert.equal(peakMax(peaks, 2, 1, 2), 0.9);
    assert.equal(peakMax(peaks, 2, 10, 20), 0);
  });

  it('gives each bar a fixed slot of time', () => {
    const a = waveformBars({
      peaks,
      rate: 2,
      startSec: 0,
      endSec: 3,
      width: 300,
      pitch: 50,
    });
    const b = waveformBars({
      peaks,
      rate: 2,
      startSec: 0.25,
      endSec: 3.25,
      width: 300,
      pitch: 50,
    });
    const slotA = a.find(bar => bar.tSec === 1);
    const slotB = b.find(bar => bar.tSec === 1);
    assert.ok(slotA && slotB);
    close(slotA.amp, slotB.amp);
    close(slotA.x - slotB.x, 25);
  });
});

describe('particle field', () => {
  const field: ParticleFieldOptions = {
    seed: 'test',
    count: 40,
    area: [0, 0, 1920, 1080],
    drift: [18, -9],
    speed: [0.5, 1.5],
    depths: [0.5, 1, 1.5],
    size: [40, 150],
    sway: {amplitude: [6, 22], periodSec: [2.8, 5.3]},
    twinkleSec: [1.3, 3.2],
    colors: ['#ff00ff', '#ffffff'],
  };
  const inside = (frame: number) => {
    for (const p of particleField(frame, 60, field)) {
      // The wrap margin is the size and the widest sway; the sway adds its own.
      const margin = p.size + 2 * 22 * p.depth;
      assert.ok(p.x >= -margin && p.x <= 1920 + margin, `x ${p.x} at ${frame}`);
      assert.ok(p.y >= -p.size && p.y <= 1080 + p.size, `y ${p.y} at ${frame}`);
      assert.ok(p.twinkle >= 0 && p.twinkle <= 1);
    }
  };

  it('is the same every time for a seed', () => {
    assert.deepEqual(
      particleField(300, 60, field),
      particleField(300, 60, field),
    );
    assert.equal(particleField(0, 60, field).length, 40);
    assert.notDeepEqual(
      particleField(300, 60, field),
      particleField(300, 60, {...field, seed: 'other'}),
    );
  });

  it('wraps around its area, however long it runs', () => {
    for (const frame of [0, 60, 3600, 60 * 3600, 60 * 86400]) inside(frame);
    // After an hour the field is as spread out as at the start: it has not
    // drifted into a corner.
    const later = particleField(60 * 3600, 60, field);
    const xs = later.map(p => p.x);
    const ys = later.map(p => p.y);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 1000);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 500);
  });

  it('drifts at its speed and depth between wraps, the same at any fps', () => {
    const still = {...field, sway: undefined};
    const a = particleField(600, 60, still);
    const b = particleField(601, 60, still);
    const c = particleField(300, 30, still);
    a.forEach((p, i) => {
      const q = b[i];
      assert.ok(q);
      const dx = q.x - p.x;
      // One frame's drift, unless the particle wrapped this frame.
      if (Math.abs(dx) < 100) {
        const perFrame = dx * 60;
        assert.ok(
          perFrame >= 18 * 0.5 * 0.5 - 1e-6 &&
            perFrame <= 18 * 1.5 * 1.5 + 1e-6,
        );
      }
      close(p.x, c[i]?.x ?? NaN, 1e-6);
      close(p.y, c[i]?.y ?? NaN, 1e-6);
    });
  });
});

describe('particles near a wrap', () => {
  it('are out of sight on both sides of it, sway and all', () => {
    const area = [0, 0, 1920, 1080] as const;
    const o: ParticleFieldOptions = {
      seed: 'wrap',
      count: 24,
      area,
      // At most 3 px a frame, so a wrap is caught within a frame of it.
      drift: [120, 0],
      speed: [0.5, 1.5],
      size: [40, 120],
      sway: {amplitude: [40, 80], periodSec: [0.5, 1]},
      colors: ['#ffffff'],
    };
    let wraps = 0;
    for (let f = 0; f < 1200; f++) {
      const a = particleField(f, 60, o);
      const b = particleField(f + 1, 60, o);
      a.forEach((p, i) => {
        const q = b[i];
        assert.ok(q);
        if (Math.abs(q.x - p.x) < 500) return;
        wraps++;
        const [before, after] = q.x < p.x ? [p, q] : [q, p];
        assert.ok(before.x - before.size / 2 > area[2], `seen leaving at ${f}`);
        assert.ok(after.x + after.size / 2 < area[0], `seen arriving at ${f}`);
      });
    }
    assert.ok(wraps > 10, `only ${wraps} wraps`);
  });
});

describe('slate layout from an origin', () => {
  const portrait = formatOf({
    fps: 30,
    width: 1080,
    height: 1920,
    durationInFrames: 1,
  });

  it('keeps an origin inside the safe box and measures from it', () => {
    const {safe} = portrait;
    const l = layoutOf(portrait, {x: 10, y: 5000});
    assert.equal(l.slateX, safe.x);
    assert.equal(l.slateY, safe.y + safe.height);
    assert.equal(l.slateWidth, safe.width);
    const m = layoutOf(portrait, {x: 600});
    assert.equal(m.slateWidth, safe.x + safe.width - 600);
    assert.equal(m.headlineMaxWidth, m.slateWidth);
    assert.deepEqual(layoutOf(portrait, {}), layoutOf(portrait));
  });
});

describe('sting meta', () => {
  const meta: StingMeta = {
    version: 1,
    fps: 60,
    frames: 120,
    globalStart: 27,
    digits: 4,
    frameSizePx: 512,
    appearFrame: 3,
    impactFrame: 33,
    flashFrames: [36, 39],
    restFrames: [53, 119],
    sheenFrames: [93],
    rest: {
      centerPx: [256, 256],
      squarePx: 215,
      cornerRadiusPx: 46,
      iconBoxPx: 123,
      strokePx: 10,
    },
  };

  it('passes a whole meta', () => {
    assert.deepEqual(stingMetaProblems(meta), []);
    assert.doesNotThrow(() => assertStingMeta(meta));
  });

  it('names every problem in one throw', () => {
    const broken = {
      ...meta,
      version: 2,
      impactFrame: 120,
      restFrames: [53],
      rest: {...meta.rest, centerPx: [256, 'x'], strokePx: 0},
    };
    assert.throws(
      () => assertStingMeta(broken),
      (e: Error) =>
        /version 2 is not 1/.test(e.message) &&
        /impactFrame must be at most 119/.test(e.message) &&
        /restFrames must be \[first, last\]/.test(e.message) &&
        /rest\.centerPx\[1\] must be a number/.test(e.message) &&
        /rest\.strokePx must be above 0/.test(e.message),
    );
    assert.deepEqual(stingMetaProblems(null), [
      'the sting meta must be an object',
    ]);
  });
});
