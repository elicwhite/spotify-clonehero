/**
 * Tests for the highway camera fit (plan 0077 item 1).
 *
 * No THREE, no DOM: `computeHighwayCameraFit` is pure geometry, and what it
 * returns is exactly what `stage.ts` writes onto a camera. Everything these
 * assertions need beyond `{fovDeg, ndcShiftY}` — how wide the frustum reaches
 * at the strikeline, where the strikeline lands vertically — is derived here
 * from the published camera geometry rather than reported by the fit, so a fit
 * that is wrong about itself cannot agree with its own tests.
 *
 * `stage-camera-fit.test.ts` is the other half: it mounts real cameras and
 * projects real floor edges through them.
 */

import {
  computeHighwayCameraFit,
  strikelineInCameraSpace,
  HIGHWAY_CAMERA,
  type HighwayCameraFit,
} from '../cameraFit';
import {MIN_HIGHWAY_PX} from '../layout';

const CANVAS_H = 400;

/** Drum highway (0.9) and five-fret highway (1.1), halved. */
const HALF_WIDTHS = [0.45, 0.55];

/** Every rect width `MAX_HIGHWAYS` can produce on a laptop-sized canvas. */
const RECT_WIDTHS = [1440, 720, 480, 360, 288, 240, MIN_HIGHWAY_PX];

const {depth, viewY} = strikelineInCameraSpace();

function halfTan(fovDeg: number): number {
  return Math.tan((fovDeg * Math.PI) / 360);
}

/** World half-width this fit's frustum spans at the strikeline. */
function visibleHalfWidth(fit: HighwayCameraFit, aspect: number): number {
  return depth * halfTan(fit.fovDeg) * aspect;
}

/** Where the strikeline lands vertically in NDC, before `ndcShiftY`. */
function unshiftedStrikelineNdcY(fit: HighwayCameraFit): number {
  return viewY / (depth * halfTan(fit.fovDeg));
}

function fitFor(width: number, halfWidth: number, height = CANVAS_H) {
  const aspect = width / height;
  return {aspect, fit: computeHighwayCameraFit({aspect, halfWidth})};
}

describe('computeHighwayCameraFit', () => {
  it.each(HALF_WIDTHS)(
    'keeps the whole %f half-width highway inside the frustum at every rect width',
    halfWidth => {
      for (const width of RECT_WIDTHS) {
        const {aspect, fit} = fitFor(width, halfWidth);
        expect(visibleHalfWidth(fit, aspect)).toBeGreaterThanOrEqual(halfWidth);
        expect(fit.fovDeg).toBeLessThan(180);
      }
    },
  );

  it('leaves a rect wide enough for the highway on the unfitted camera', () => {
    // 900x400 is the widest lane a three-highway strip produces; the highway
    // already fits there, so the camera must be untouched.
    const {aspect, fit} = fitFor(900, 0.55);
    expect(fit.fovDeg).toBe(HIGHWAY_CAMERA.fovDeg);
    expect(fit.ndcShiftY).toBe(0);
    expect(visibleHalfWidth(fit, aspect)).toBeGreaterThan(0.55);
  });

  it('never zooms in, however wide the rect gets', () => {
    for (const width of [900, 2400, 10000]) {
      const {fit} = fitFor(width, 0.45);
      expect(fit.fovDeg).toBe(HIGHWAY_CAMERA.fovDeg);
      expect(fit.ndcShiftY).toBe(0);
    }
  });

  it('widens monotonically as the rect narrows', () => {
    const fovs = RECT_WIDTHS.map(width => fitFor(width, 0.55).fit.fovDeg);
    for (let i = 1; i < fovs.length; i++) {
      expect(fovs[i]).toBeGreaterThanOrEqual(fovs[i - 1]);
    }
    // The narrowest lane a six-highway strip produces genuinely needs it.
    expect(fovs[fovs.length - 1]).toBeGreaterThan(HIGHWAY_CAMERA.fovDeg);
  });

  it('fits a five-fret highway wider than a drum one at the same rect', () => {
    const drums = fitFor(MIN_HIGHWAY_PX, 0.45);
    const fiveFret = fitFor(MIN_HIGHWAY_PX, 0.55);
    expect(fiveFret.fit.fovDeg).toBeGreaterThan(drums.fit.fovDeg);
    expect(visibleHalfWidth(fiveFret.fit, fiveFret.aspect)).toBeGreaterThan(
      visibleHalfWidth(drums.fit, drums.aspect),
    );
  });

  it('holds the strikeline at the height a full-width highway puts it', () => {
    const reference = fitFor(1440, 0.55).fit;
    const referenceNdcY = unshiftedStrikelineNdcY(reference);
    for (const width of RECT_WIDTHS) {
      const {fit} = fitFor(width, 0.55);
      // Widening the frustum divides every NDC coordinate by the same factor;
      // the reported shift is what puts the strikeline back.
      expect(unshiftedStrikelineNdcY(fit) + fit.ndcShiftY).toBeCloseTo(
        referenceNdcY,
        10,
      );
    }
    // Near the bottom of the frame, where a full-width highway keeps it.
    expect(referenceNdcY).toBeLessThan(-0.8);
    expect(referenceNdcY).toBeGreaterThan(-1);
  });

  it('survives a degenerate rect without producing an unbuildable frustum', () => {
    for (const aspect of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fit = computeHighwayCameraFit({aspect, halfWidth: 0.55});
      expect(Number.isFinite(fit.fovDeg)).toBe(true);
      expect(fit.fovDeg).toBeLessThan(180);
      expect(Number.isFinite(fit.ndcShiftY)).toBe(true);
    }
    const noWidth = computeHighwayCameraFit({aspect: 0.5, halfWidth: 0});
    expect(noWidth.fovDeg).toBe(HIGHWAY_CAMERA.fovDeg);
    expect(noWidth.ndcShiftY).toBe(0);
  });
});
