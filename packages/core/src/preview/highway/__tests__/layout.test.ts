/**
 * Tests for the pure stage layout math (plan 0075 §2).
 *
 * No THREE, no DOM: `computeStageLayout` is the single source both the DOM
 * interaction overlays and the GL viewport/scissor rects read, so its
 * tiling invariants are what keep hit-testing aligned with pixels.
 */

import {
  computeStageLayout,
  toGlRect,
  HIGHWAY_GAP_PX,
  MAX_HIGHWAYS,
  MIN_HIGHWAY_PX,
  type HighwayRect,
} from '../layout';

const CANVAS_H = 400;

function widths(rects: HighwayRect[]): number[] {
  return rects.map(r => r.width);
}

describe('computeStageLayout -- rects', () => {
  it.each([1, 2, 3, 6])('tiles the canvas exactly for %i highways', count => {
    const canvasWidth = 1600;
    const layout = computeStageLayout({
      canvasWidth,
      canvasHeight: CANVAS_H,
      highwayCount: count,
    });

    expect(layout.measured).toBe(true);
    expect(layout.highways).toHaveLength(count);

    const totalGap = (count - 1) * HIGHWAY_GAP_PX;
    const totalWidth = widths(layout.highways).reduce((a, b) => a + b, 0);
    expect(totalWidth + totalGap).toBe(canvasWidth);

    // Left edge flush, right edge flush.
    expect(layout.highways[0].x).toBe(0);
    const last = layout.highways[count - 1];
    expect(last.x + last.width).toBe(canvasWidth);

    // Every rect spans the full canvas height.
    for (const rect of layout.highways) {
      expect(rect.y).toBe(0);
      expect(rect.height).toBe(CANVAS_H);
      expect(rect.width).toBeGreaterThan(0);
    }
  });

  it('separates adjacent highways by exactly HIGHWAY_GAP_PX and never overlaps', () => {
    const layout = computeStageLayout({
      canvasWidth: 999,
      canvasHeight: CANVAS_H,
      highwayCount: 4,
    });

    for (let i = 1; i < layout.highways.length; i++) {
      const prev = layout.highways[i - 1];
      const cur = layout.highways[i];
      expect(cur.x - (prev.x + prev.width)).toBe(HIGHWAY_GAP_PX);
    }
  });

  it('keeps widths within one pixel of each other on a non-divisible width', () => {
    const layout = computeStageLayout({
      canvasWidth: 1001,
      canvasHeight: CANVAS_H,
      highwayCount: 3,
    });

    const w = widths(layout.highways);
    expect(Math.max(...w) - Math.min(...w)).toBeLessThanOrEqual(1);
    // 1001 - 2 gaps = 999, split three ways.
    expect(w.reduce((a, b) => a + b, 0)).toBe(999);
  });

  it('returns integer rects for an integer canvas width', () => {
    const layout = computeStageLayout({
      canvasWidth: 1280,
      canvasHeight: 720,
      highwayCount: 5,
    });

    for (const rect of layout.highways) {
      expect(Number.isInteger(rect.x)).toBe(true);
      expect(Number.isInteger(rect.width)).toBe(true);
    }
  });

  it('returns no rects for a zero highway count', () => {
    const layout = computeStageLayout({
      canvasWidth: 1200,
      canvasHeight: CANVAS_H,
      highwayCount: 0,
    });
    expect(layout.highways).toEqual([]);
    expect(layout.measured).toBe(true);
  });
});

describe('computeStageLayout -- maxHighways', () => {
  it('is 1 for a canvas narrower than one minimum highway', () => {
    expect(
      computeStageLayout({
        canvasWidth: 120,
        canvasHeight: CANVAS_H,
        highwayCount: 1,
      }).maxHighways,
    ).toBe(1);
  });

  it('admits n highways at exactly n*MIN + (n-1)*GAP and not one pixel less', () => {
    for (let n = 1; n <= MAX_HIGHWAYS; n++) {
      const exact = n * MIN_HIGHWAY_PX + (n - 1) * HIGHWAY_GAP_PX;
      expect(
        computeStageLayout({
          canvasWidth: exact,
          canvasHeight: CANVAS_H,
          highwayCount: 1,
        }).maxHighways,
      ).toBe(n);
      expect(
        computeStageLayout({
          canvasWidth: exact - 1,
          canvasHeight: CANVAS_H,
          highwayCount: 1,
        }).maxHighways,
      ).toBe(Math.max(1, n - 1));
    }
  });

  it('is monotone in width and clamped to [1, MAX_HIGHWAYS]', () => {
    let previous = 0;
    for (let width = 1; width <= 4000; width += 7) {
      const {maxHighways} = computeStageLayout({
        canvasWidth: width,
        canvasHeight: CANVAS_H,
        highwayCount: 1,
      });
      expect(maxHighways).toBeGreaterThanOrEqual(1);
      expect(maxHighways).toBeLessThanOrEqual(MAX_HIGHWAYS);
      expect(maxHighways).toBeGreaterThanOrEqual(previous);
      previous = maxHighways;
    }
    expect(previous).toBe(MAX_HIGHWAYS);
  });
});

describe('computeStageLayout -- unmeasured width', () => {
  // This is the rule the jsdom routing suites depend on: jsdom has no layout,
  // so offsetWidth is 0. Falling back to MAX_HIGHWAYS keeps pane routing,
  // labelling, and overflow behaving as they do at full width; only rect
  // assertions are gated on `measured`.
  it.each([0, NaN, Infinity, -100])(
    'falls back to MAX_HIGHWAYS with measured=false at width %p',
    canvasWidth => {
      const layout = computeStageLayout({
        canvasWidth,
        canvasHeight: 0,
        highwayCount: 3,
      });

      expect(layout.measured).toBe(false);
      expect(layout.maxHighways).toBe(MAX_HIGHWAYS);
      expect(layout.highways).toHaveLength(3);
      expect(widths(layout.highways)).toEqual([0, 0, 0]);
      expect(layout.canvas).toEqual({width: 0, height: 0});
    },
  );
});

describe('computeStageLayout -- degenerate inputs', () => {
  it('treats a non-finite height as unmeasured height without breaking rects', () => {
    const layout = computeStageLayout({
      canvasWidth: 800,
      canvasHeight: NaN,
      highwayCount: 2,
    });
    expect(layout.measured).toBe(true);
    expect(layout.canvas.height).toBe(0);
    for (const rect of layout.highways) {
      expect(rect.height).toBe(0);
      expect(Number.isNaN(rect.width)).toBe(false);
    }
  });

  it('ignores a negative or fractional highway count', () => {
    expect(
      computeStageLayout({
        canvasWidth: 800,
        canvasHeight: CANVAS_H,
        highwayCount: -3,
      }).highways,
    ).toEqual([]);
    expect(
      computeStageLayout({
        canvasWidth: 800,
        canvasHeight: CANVAS_H,
        highwayCount: 2.7,
      }).highways,
    ).toHaveLength(2);
  });

  it('never produces negative widths when the count exceeds what fits', () => {
    const layout = computeStageLayout({
      canvasWidth: 4,
      canvasHeight: CANVAS_H,
      highwayCount: 6,
    });
    expect(layout.highways).toHaveLength(6);
    for (const rect of layout.highways) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < layout.highways.length; i++) {
      expect(layout.highways[i].x).toBeGreaterThanOrEqual(
        layout.highways[i - 1].x,
      );
    }
  });
});

describe('toGlRect', () => {
  it('flips y to a bottom-left origin', () => {
    expect(toGlRect({x: 10, y: 0, width: 100, height: 400}, 400)).toEqual({
      x: 10,
      y: 0,
      width: 100,
      height: 400,
    });
    expect(toGlRect({x: 10, y: 50, width: 100, height: 300}, 400)).toEqual({
      x: 10,
      y: 50,
      width: 100,
      height: 300,
    });
    expect(toGlRect({x: 0, y: 0, width: 100, height: 120}, 400)).toEqual({
      x: 0,
      y: 280,
      width: 100,
      height: 120,
    });
  });

  it('round-trips', () => {
    const rect = {x: 37, y: 12, width: 210, height: 333};
    expect(toGlRect(toGlRect(rect, 400), 400)).toEqual(rect);
  });

  it('converts every rect of a real layout inside the canvas', () => {
    const layout = computeStageLayout({
      canvasWidth: 1600,
      canvasHeight: CANVAS_H,
      highwayCount: 3,
    });
    for (const rect of layout.highways) {
      const gl = toGlRect(rect, layout.canvas.height);
      expect(gl.y).toBe(0);
      expect(gl.x + gl.width).toBeLessThanOrEqual(layout.canvas.width);
    }
  });
});
