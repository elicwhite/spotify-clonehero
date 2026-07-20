import {
  BASE_PX_PER_MS,
  MIN_GLYPH_WIDTH,
  clampLeftMs,
  fitToWidth,
  followLeftMs,
  glyphWidth,
  msToX,
  panByPx,
  visibleMsRange,
  xToMs,
  zoomAt,
  zoomBounds,
  zoomPercent,
  type PianoRollView,
} from '../viewMath';

describe('viewMath: x <-> ms', () => {
  const view: PianoRollView = {leftMs: 1000, pxPerMs: 0.5};

  test('msToX and xToMs are inverses', () => {
    for (const ms of [1000, 2000, 3456.7]) {
      expect(xToMs(msToX(ms, view), view)).toBeCloseTo(ms, 6);
    }
  });

  test('leftMs maps to x=0', () => {
    expect(msToX(view.leftMs, view)).toBe(0);
  });

  test('visibleMsRange spans the viewport width', () => {
    const [a, b] = visibleMsRange(view, 800);
    expect(a).toBe(1000);
    expect(b).toBe(1000 + 800 / 0.5);
  });
});

describe('viewMath: zoom-anchor invariance', () => {
  const totalMs = 200000;
  const width = 900;

  test('the ms under the cursor stays fixed across a zoom-in', () => {
    const view: PianoRollView = {leftMs: 5000, pxPerMs: BASE_PX_PER_MS};
    const bounds = zoomBounds(width, totalMs);
    const offsetX = 320;
    const anchorMs = xToMs(offsetX, view);
    const zoomed = zoomAt(view, offsetX, -300, width, totalMs, bounds);
    // pxPerMs must have increased (zoom in on negative deltaY).
    expect(zoomed.pxPerMs).toBeGreaterThan(view.pxPerMs);
    // The anchor ms is still under the same screen x.
    expect(msToX(anchorMs, zoomed)).toBeCloseTo(offsetX, 3);
  });

  test('the ms under the cursor stays fixed across a zoom-out', () => {
    const view: PianoRollView = {leftMs: 40000, pxPerMs: BASE_PX_PER_MS * 4};
    const bounds = zoomBounds(width, totalMs);
    const offsetX = 610;
    const anchorMs = xToMs(offsetX, view);
    const zoomed = zoomAt(view, offsetX, 240, width, totalMs, bounds);
    expect(zoomed.pxPerMs).toBeLessThan(view.pxPerMs);
    // After re-clamping leftMs to the song, the anchor may be pushed if the
    // clamp engaged; assert it holds while inside the clamp range.
    if (
      zoomed.leftMs > (-width / zoomed.pxPerMs) * 0.05 + 1 &&
      zoomed.leftMs < totalMs - (width / zoomed.pxPerMs) * 0.5 - 1
    ) {
      expect(msToX(anchorMs, zoomed)).toBeCloseTo(offsetX, 3);
    }
  });

  test('zoom is clamped to bounds', () => {
    const view: PianoRollView = {leftMs: 0, pxPerMs: BASE_PX_PER_MS};
    const bounds = zoomBounds(width, totalMs);
    // Huge zoom-in delta clamps at max.
    const zin = zoomAt(view, 0, -100000, width, totalMs, bounds);
    expect(zin.pxPerMs).toBeCloseTo(bounds.max, 9);
    // Huge zoom-out delta clamps at min.
    const zout = zoomAt(view, 0, 100000, width, totalMs, bounds);
    expect(zout.pxPerMs).toBeCloseTo(bounds.min, 9);
  });
});

describe('viewMath: zoomBounds / fitToWidth', () => {
  test('min bound always permits full-song visibility', () => {
    const width = 800;
    const totalMs = 240000; // 4 minutes
    const bounds = zoomBounds(width, totalMs);
    // At the min zoom, the whole song fits within the viewport.
    expect(totalMs * bounds.min).toBeLessThanOrEqual(width + 1e-6);
  });

  test('fitToWidth shows the whole song from the start', () => {
    const width = 800;
    const totalMs = 180000;
    const fit = fitToWidth(width, totalMs);
    expect(fit.leftMs).toBe(0);
    expect(msToX(totalMs, fit)).toBeLessThanOrEqual(width + 1e-6);
  });

  test('zoomPercent reports 100% at base scale', () => {
    expect(zoomPercent(BASE_PX_PER_MS)).toBe(100);
    expect(zoomPercent(BASE_PX_PER_MS * 2)).toBe(200);
  });

  test('short song: min is exactly the fit-to-width scale', () => {
    const width = 800;
    const totalMs = 5000; // a few seconds; fit is far above the old base/16 floor
    const bounds = zoomBounds(width, totalMs);
    expect(bounds.min).toBeCloseTo(width / totalMs, 9);
  });

  test('totalMs = 0 falls back to BASE_PX_PER_MS', () => {
    const bounds = zoomBounds(800, 0);
    expect(bounds.min).toBe(BASE_PX_PER_MS);
  });

  test('min never exceeds max, even for a degenerate short song', () => {
    // Very short song / narrow viewport: fit would exceed max unclamped.
    const bounds = zoomBounds(50, 10);
    expect(bounds.min).toBeLessThanOrEqual(bounds.max);
    expect(bounds.min).toBe(bounds.max);
  });
});

describe('viewMath: clampLeftMs / panByPx', () => {
  const totalMs = 100000;
  const width = 500;
  const pxPerMs = 0.05;

  test('clamps within slack bounds', () => {
    const visible = width / pxPerMs;
    const lo = -visible * 0.05;
    const hi = totalMs - visible * 0.5;
    expect(clampLeftMs(-1e9, width, totalMs, pxPerMs)).toBeCloseTo(lo, 6);
    expect(clampLeftMs(1e9, width, totalMs, pxPerMs)).toBeCloseTo(hi, 6);
  });

  test('panByPx moves leftMs by deltaPx / pxPerMs', () => {
    const view: PianoRollView = {leftMs: 10000, pxPerMs};
    const panned = panByPx(view, 100, width, totalMs);
    expect(panned.pxPerMs).toBe(pxPerMs);
    expect(panned.leftMs).toBeCloseTo(10000 + 100 / pxPerMs, 6);
  });
});

describe('viewMath: catch-up follow state machine', () => {
  const width = 1000;
  const pxPerMs = 0.1; // visible window = 10000ms
  const totalMs = 300000;

  test('view stays still until the playhead reaches the anchor (0.5)', () => {
    const leftMs = 0;
    // Anchor at 0.5 => 5000ms. Playhead before it: no scroll.
    expect(
      followLeftMs({
        playheadMs: 3000,
        leftMs,
        pxPerMs,
        viewportWidth: width,
        anchorFraction: 0.5,
        totalMs,
      }),
    ).toBe(leftMs);
  });

  test('view scrolls to pin the playhead once it passes the anchor (0.5)', () => {
    const leftMs = 0;
    const next = followLeftMs({
      playheadMs: 7000,
      leftMs,
      pxPerMs,
      viewportWidth: width,
      anchorFraction: 0.5,
      totalMs,
    });
    // Playhead should now sit at anchor: leftMs + visible*0.5 == playhead.
    const visible = width / pxPerMs;
    expect(next + visible * 0.5).toBeCloseTo(7000, 6);
  });

  test('anchor 0.2 pins earlier than 0.5', () => {
    const leftMs = 0;
    const visible = width / pxPerMs; // 10000
    // At anchor 0.2 => 2000ms; a playhead at 3000 is already past it.
    const next02 = followLeftMs({
      playheadMs: 3000,
      leftMs,
      pxPerMs,
      viewportWidth: width,
      anchorFraction: 0.2,
      totalMs,
    });
    expect(next02 + visible * 0.2).toBeCloseTo(3000, 6);
    // Same playhead at anchor 0.5 (=5000) has not been reached: no scroll.
    const next05 = followLeftMs({
      playheadMs: 3000,
      leftMs,
      pxPerMs,
      viewportWidth: width,
      anchorFraction: 0.5,
      totalMs,
    });
    expect(next05).toBe(leftMs);
  });

  test('off-screen playhead snaps to the anchor', () => {
    // Playhead far to the left of the view (offscreen), away from the song
    // ends so the clamp doesn't engage.
    const leftMs = 200000;
    const playheadMs = 100000;
    const next = followLeftMs({
      playheadMs,
      leftMs,
      pxPerMs,
      viewportWidth: width,
      anchorFraction: 0.5,
      totalMs,
    });
    const visible = width / pxPerMs;
    expect(next + visible * 0.5).toBeCloseTo(playheadMs, 6);
    expect(next).not.toBe(leftMs);
  });
});

describe('viewMath: glyphWidth', () => {
  test('clamps to [MIN_GLYPH_WIDTH, glyphHeight]', () => {
    // Very zoomed out: raw width tiny -> clamps to MIN.
    expect(
      glyphWidth({
        gridStepTicks: 120,
        msPerTick: 1,
        pxPerMs: 0.0001,
        glyphHeight: 13,
      }),
    ).toBe(MIN_GLYPH_WIDTH);
    // Very zoomed in: raw width large -> clamps to glyphHeight.
    expect(
      glyphWidth({
        gridStepTicks: 120,
        msPerTick: 1,
        pxPerMs: 10,
        glyphHeight: 13,
      }),
    ).toBe(13);
  });

  test('tracks spacing in the middle of the range', () => {
    const w = glyphWidth({
      gridStepTicks: 120,
      msPerTick: 0.5,
      pxPerMs: 0.1,
      glyphHeight: 13,
    });
    // raw = 120 * 0.5 * 0.1 * 0.72 = 4.32
    expect(w).toBeCloseTo(4.32, 6);
  });
});
