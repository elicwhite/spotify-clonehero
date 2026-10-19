/**
 * Pure placement math for the editor's right-click menu (plan 0079 item 3:
 * flip to fit). All coordinates here are viewport space — the conversion
 * from the popover's two anchor modes is the component's job, not this
 * module's.
 */

import {computeContextMenuPlacement} from '../contextMenuPlacement';

const VIEWPORT = {viewportWidth: 1000, viewportHeight: 800};

describe('computeContextMenuPlacement', () => {
  it('opens below-right of the pointer when it fits', () => {
    const placement = computeContextMenuPlacement({
      pointerX: 100,
      pointerY: 100,
      menuWidth: 150,
      menuHeight: 200,
      ...VIEWPORT,
    });
    expect(placement).toEqual({x: 100, y: 100, maxHeight: undefined});
  });

  it('flips upward when it would overflow the bottom of the viewport', () => {
    const placement = computeContextMenuPlacement({
      pointerX: 100,
      pointerY: 700,
      menuWidth: 150,
      menuHeight: 200,
      ...VIEWPORT,
    });
    // 700 + 200 = 900 > 800 - 4, so it opens upward from the pointer instead.
    expect(placement.y).toBe(700 - 200);
    expect(placement.x).toBe(100);
    expect(placement.maxHeight).toBeUndefined();
  });

  it('flips leftward when it would overflow the right edge of the viewport', () => {
    const placement = computeContextMenuPlacement({
      pointerX: 900,
      pointerY: 100,
      menuWidth: 150,
      menuHeight: 200,
      ...VIEWPORT,
    });
    // 900 + 150 = 1050 > 1000 - 4, so it opens leftward from the pointer.
    expect(placement.x).toBe(900 - 150);
    expect(placement.y).toBe(100);
  });

  it('flips both axes at once when the pointer is near the bottom-right corner', () => {
    const placement = computeContextMenuPlacement({
      pointerX: 900,
      pointerY: 700,
      menuWidth: 150,
      menuHeight: 200,
      ...VIEWPORT,
    });
    expect(placement.x).toBe(900 - 150);
    expect(placement.y).toBe(700 - 200);
    expect(placement.maxHeight).toBeUndefined();
  });

  it('clamps to the viewport with a scroll allowance when taller than the viewport in either direction', () => {
    const placement = computeContextMenuPlacement({
      pointerX: 100,
      pointerY: 400,
      menuWidth: 150,
      menuHeight: 1200, // taller than the 800px viewport
      ...VIEWPORT,
    });
    // Doesn't fit below (400 + 1200) or above (400 - 1200 < margin), so it's
    // clamped to the top of the viewport with a max-height to scroll within.
    expect(placement.y).toBe(4);
    expect(placement.maxHeight).toBe(800 - 4 * 2);
    expect(placement.x).toBe(100);
  });

  it('clamps horizontally too when the menu is wider than the viewport', () => {
    const placement = computeContextMenuPlacement({
      pointerX: 500,
      pointerY: 100,
      menuWidth: 1200,
      menuHeight: 200,
      ...VIEWPORT,
    });
    expect(placement.x).toBe(4);
  });

  it('honours a custom margin', () => {
    const placement = computeContextMenuPlacement({
      pointerX: 100,
      pointerY: 700,
      menuWidth: 150,
      menuHeight: 200,
      viewportWidth: 1000,
      viewportHeight: 800,
      margin: 20,
    });
    expect(placement.y).toBe(700 - 200);
  });
});
