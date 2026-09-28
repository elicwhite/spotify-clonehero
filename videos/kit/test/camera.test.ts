import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {CSSProperties} from 'react';
import {lensFor} from '../src/camera/lens';
import {
  compose,
  IDENTITY,
  multiply,
  perspective,
  projectPoint,
  rotateX,
  translate3d,
} from '../src/camera/matrix';
import {cameraBlur, makePath, orbit} from '../src/camera/path';
import {
  edgeOnFold,
  IDENTITY_LOCAL,
  placeOnPlane,
  planeMatrix,
  project,
  restPose,
  type Placement,
  type Pose,
} from '../src/camera/pose';
import {linear} from '../src/motion/easing';

const close = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

const FRAME = {width: 1920, height: 1080};
const lens = lensFor(FRAME);

/**
 * The same projection written out step by step (scale, rotateZ, rotateY,
 * rotateX, the pin, then the CSS perspective divide about the lens origin),
 * independent of the matrix code.
 */
const byHand = (p: Pose, u: number, v: number) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  let x = (u - p.fx) * p.s;
  let y = (v - p.fy) * p.s;
  let z = 0;
  [x, y] = [
    x * Math.cos(rad(p.rz)) - y * Math.sin(rad(p.rz)),
    x * Math.sin(rad(p.rz)) + y * Math.cos(rad(p.rz)),
  ];
  [x, z] = [
    x * Math.cos(rad(p.ry)) + z * Math.sin(rad(p.ry)),
    -x * Math.sin(rad(p.ry)) + z * Math.cos(rad(p.ry)),
  ];
  [y, z] = [
    y * Math.cos(rad(p.rx)) - z * Math.sin(rad(p.rx)),
    y * Math.sin(rad(p.rx)) + z * Math.cos(rad(p.rx)),
  ];
  x += p.sx;
  y += p.sy;
  z += p.z;
  const k = lens.perspective / (lens.perspective - z);
  return {
    x: lens.origin.x + (x - lens.origin.x) * k,
    y: lens.origin.y + (y - lens.origin.y) * k,
  };
};

const turned: Pose = {
  ...restPose(FRAME, {x: 720, y: 450}),
  sx: 1100,
  sy: 600,
  s: 1.7,
  rx: 11,
  ry: -14,
  rz: 2.5,
};

/**
 * Where the browser draws an element's point (x, y) given its style from
 * `placeOnPlane`: at left 0, top 0, origin 0 0, the CSS matrix3d (16 values,
 * column by column) applied and divided by w. Parsed from the string, so it
 * checks what the page is handed.
 */
const drawnAt = (style: CSSProperties, x: number, y: number) => {
  assert.equal(style.left, 0);
  assert.equal(style.top, 0);
  assert.equal(style.transformOrigin, '0 0');
  const m = /^matrix3d\((.*)\)$/.exec(String(style.transform));
  assert.ok(m, `not a matrix3d: ${String(style.transform)}`);
  const v = (m[1] as string).split(',').map(Number);
  assert.equal(v.length, 16);
  const at = (i: number) => v[i] as number;
  const w = at(3) * x + at(7) * y + at(15);
  return {
    x: (at(0) * x + at(4) * y + at(12)) / w,
    y: (at(1) * x + at(5) * y + at(13)) / w,
  };
};

const BUTTON = {x: 1180, y: 110, width: 200, height: 48};

describe('matrix', () => {
  it('multiplies with the identity and composes in CSS order', () => {
    const m = compose(translate3d(10, 20, 30), rotateX(30));
    assert.deepEqual(multiply(IDENTITY, m), m);
    const p = projectPoint(compose(translate3d(5, 0), translate3d(0, 7)), {
      x: 1,
      y: 1,
    });
    close(p.x, 6);
    close(p.y, 8);
  });

  it('divides by the CSS perspective', () => {
    const p = projectPoint(perspective(1000), {x: 100, y: 50, z: 500});
    close(p.k, 2);
    close(p.x, 200);
    close(p.y, 100);
  });
});

describe('pose', () => {
  it('keeps the pinned plane point on its screen point', () => {
    const p = project(turned, lens, {x: 720, y: 450});
    close(p.x, 1100);
    close(p.y, 600);
    close(p.k, 1);
  });

  it('projects like the CSS transform', () => {
    for (const [u, v] of [
      [0, 0],
      [1440, 0],
      [300, 800],
      [1280, 134],
    ] as const) {
      const a = project(turned, lens, {x: u, y: v});
      const b = byHand(turned, u, v);
      close(a.x, b.x, 1e-6);
      close(a.y, b.y, 1e-6);
    }
  });

  it('leaves a placed piece with no local move or fold where the plane puts it', () => {
    const bare = project(turned, lens, {x: 1200, y: 120});
    const placed = project(
      turned,
      lens,
      {x: 1200, y: 120},
      {
        box: BUTTON,
        local: IDENTITY_LOCAL,
        fold: {axisY: 450, rx: 0},
      },
    );
    close(placed.x, bare.x);
    close(placed.y, bare.y);
  });

  it('draws a placed piece exactly where it measures it', () => {
    const placements: Placement[] = [
      {box: BUTTON},
      {
        box: BUTTON,
        local: {dx: 60, dy: -30, dz: 140, rx: -8, ry: 12, rz: -2, s: 1.3},
      },
      {
        box: {x: 0, y: 84, width: 320, height: 816},
        local: {...IDENTITY_LOCAL, dz: 200, ry: 16},
        fold: {axisY: 450, rx: 35},
      },
    ];
    for (const placement of placements) {
      const style = placeOnPlane(turned, lens, placement);
      const {box} = placement;
      assert.equal(style.width, box.width);
      assert.equal(style.height, box.height);
      for (const [x, y] of [
        [0, 0],
        [box.width, 0],
        [box.width, box.height],
        [0, box.height],
        [box.width / 3, box.height / 2],
      ] as const) {
        const drawn = drawnAt(style, x, y);
        const measured = project(
          turned,
          lens,
          {x: box.x + x, y: box.y + y},
          placement,
        );
        close(drawn.x, measured.x, 1e-6);
        close(drawn.y, measured.y, 1e-6);
      }
    }
  });

  it('is one matrix for drawing and measuring', () => {
    const placement: Placement = {box: BUTTON, fold: {axisY: 300, rx: 20}};
    const m = planeMatrix(turned, lens, placement);
    const p = projectPoint(m, {x: 1250, y: 130});
    const q = project(turned, lens, {x: 1250, y: 130}, placement);
    close(p.x, q.x);
    close(p.y, q.y);
    close(p.k, q.k);
  });

  it('folds about its axis: points on the axis stay put', () => {
    const fold = {axisY: 450, rx: 50};
    for (const x of [0, 400, 1440]) {
      const bare = project(turned, lens, {x, y: 450});
      const folded = project(
        turned,
        lens,
        {x, y: 450},
        {box: {x: 0, y: 0, width: 1440, height: 900}, fold},
      );
      close(folded.x, bare.x);
      close(folded.y, bare.y);
    }
    const off = project(
      turned,
      lens,
      {x: 400, y: 800},
      {box: {x: 0, y: 0, width: 1440, height: 900}, fold},
    );
    const offBare = project(turned, lens, {x: 400, y: 800});
    assert.ok(Math.hypot(off.x - offBare.x, off.y - offBare.y) > 10);
  });

  it('turns and scales a piece about its own centre', () => {
    const centre = {
      x: BUTTON.x + BUTTON.width / 2,
      y: BUTTON.y + BUTTON.height / 2,
    };
    const bare = project(turned, lens, centre);
    const moved = project(turned, lens, centre, {
      box: BUTTON,
      local: {...IDENTITY_LOCAL, rx: 20, ry: -30, rz: 45, s: 1.6},
    });
    close(moved.x, bare.x);
    close(moved.y, bare.y);
  });

  it('turns the plane edge-on through the eye', () => {
    close(edgeOnFold(lens.origin.y, lens), 90);
    assert.ok(edgeOnFold(lens.origin.y + 200, lens) > 90);
  });

  it('collapses the folded plane onto its axis row when edge-on', () => {
    // The rest pose draws plane px at the same screen px, so the fold axis
    // at plane y = 700 is screen row 700.
    const rest = restPose(FRAME);
    const fold = {axisY: 700, rx: edgeOnFold(700, lens)};
    const box = {x: 0, y: 0, width: FRAME.width, height: FRAME.height};
    const xs: number[] = [];
    for (const [u, v] of [
      [100, 300],
      [960, 540],
      [1800, 900],
      [500, 1000],
    ] as const) {
      const p = project(rest, lens, {x: u, y: v}, {box, fold});
      close(p.y, 700, 1e-6);
      xs.push(p.x);
    }
    // A line, not a point: the points keep their spread along it.
    assert.ok(Math.max(...xs) - Math.min(...xs) > 500);
  });
});

describe('paths', () => {
  const base = restPose(FRAME);
  const path = makePath(
    [
      {at: 10, pose: {s: 0.5}},
      {at: 40, pose: {s: 1.5, ry: 20}, ease: linear},
    ],
    base,
  );

  it('holds before the first key and after the last', () => {
    close(path(0).s, 0.5);
    close(path(100).s, 1.5);
    close(path(100).ry, 20);
  });

  it('carries unchanged fields and eases each move', () => {
    close(path(25).s, 1);
    close(path(25).ry, 10);
    close(path(25).fx, base.fx);
  });

  it('refuses keys out of order', () => {
    assert.throws(() =>
      makePath(
        [
          {at: 20, pose: {}},
          {at: 10, pose: {}},
        ],
        base,
      ),
    );
  });

  it('orbits only when asked, the same at any fps', () => {
    assert.deepEqual(orbit(base, 123, 60, {amount: 0}), base);
    const a = orbit(base, 120, 60);
    const b = orbit(base, 60, 30);
    close(a.ry, b.ry);
    close(a.rx, b.rx);
  });

  it('blurs fast moves and nothing else', () => {
    const at60 = {fps: 60, unit: 1};
    const still = () => base;
    assert.equal(cameraBlur(still, 50, at60, {lens}), 0);
    const whip = (f: number): Pose => ({...base, sx: base.sx + 60 * f});
    assert.ok(cameraBlur(whip, 50, at60, {lens}) > 0);
    // The travel is measured over seconds, so the blur is the same at 30 fps.
    const whip30 = (f: number): Pose => ({...base, sx: base.sx + 120 * f});
    close(
      cameraBlur(whip, 50, at60, {lens}),
      cameraBlur(whip30, 25, {fps: 30, unit: 1}, {lens}),
    );
  });

  it('scales its threshold with the format', () => {
    // 12 px per 1/30 s is past the 10 px threshold at 1080p, and under it
    // in 4K, where the threshold is the same 10 reference px: 20 px.
    const base4k = restPose({width: 3840, height: 2160});
    const lens4k = lensFor({width: 3840, height: 2160});
    const slow = (f: number): Pose => ({...base, sx: base.sx + 6 * f});
    const slow4k = (f: number): Pose => ({...base4k, sx: base4k.sx + 6 * f});
    assert.ok(cameraBlur(slow, 50, {fps: 60, unit: 1}, {lens}) > 0);
    assert.equal(cameraBlur(slow4k, 50, {fps: 60, unit: 2}, {lens: lens4k}), 0);
  });
});
