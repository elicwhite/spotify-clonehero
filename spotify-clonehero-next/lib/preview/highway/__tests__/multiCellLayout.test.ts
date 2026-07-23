import {
  computeCellViewport,
  cellTextureKey,
  type CellRect,
} from '../multiCellLayout';

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): CellRect {
  return {left, top, width, height, right: left + width, bottom: top + height};
}

describe('computeCellViewport', () => {
  const CANVAS_W = 1000;
  const CANVAS_H = 800;

  it('flips a top-down DOM rect to a bottom-up GL viewport', () => {
    // A 200x150 cell 50px from the left, 100px from the top.
    const vp = computeCellViewport(rect(50, 100, 200, 150), CANVAS_W, CANVAS_H);
    expect(vp).toEqual({
      x: 50,
      // GL origin is bottom-left: y = canvasH - rect.bottom = 800 - 250.
      y: 550,
      w: 200,
      h: 150,
      visible: true,
    });
  });

  it('places a cell flush with the canvas top at the GL top', () => {
    const vp = computeCellViewport(rect(0, 0, 100, 100), CANVAS_W, CANVAS_H);
    expect(vp.y).toBe(CANVAS_H - 100);
    expect(vp.visible).toBe(true);
  });

  it('places a cell flush with the canvas bottom at GL y=0', () => {
    const vp = computeCellViewport(
      rect(0, CANVAS_H - 100, 100, 100),
      CANVAS_W,
      CANVAS_H,
    );
    expect(vp.y).toBe(0);
    expect(vp.visible).toBe(true);
  });

  it('marks a zero-area cell not visible', () => {
    expect(
      computeCellViewport(rect(10, 10, 0, 100), CANVAS_W, CANVAS_H).visible,
    ).toBe(false);
    expect(
      computeCellViewport(rect(10, 10, 100, 0), CANVAS_W, CANVAS_H).visible,
    ).toBe(false);
  });

  it('marks a cell scrolled fully above the canvas not visible', () => {
    // bottom = -1 <= 0 → entirely above the viewport.
    const vp = computeCellViewport(rect(0, -201, 100, 200), CANVAS_W, CANVAS_H);
    expect(vp.visible).toBe(false);
  });

  it('marks a cell scrolled fully below the canvas not visible', () => {
    // top = CANVAS_H → at/over the bottom edge.
    const vp = computeCellViewport(
      rect(0, CANVAS_H, 100, 200),
      CANVAS_W,
      CANVAS_H,
    );
    expect(vp.visible).toBe(false);
  });

  it('marks a cell fully left/right of the canvas not visible', () => {
    expect(
      computeCellViewport(rect(-200, 10, 200, 100), CANVAS_W, CANVAS_H).visible,
    ).toBe(false);
    expect(
      computeCellViewport(rect(CANVAS_W, 10, 200, 100), CANVAS_W, CANVAS_H)
        .visible,
    ).toBe(false);
  });

  it('keeps a partially-visible cell visible', () => {
    // Half scrolled off the top: top=-100, bottom=100 (>0) → still visible.
    const vp = computeCellViewport(rect(0, -100, 100, 200), CANVAS_W, CANVAS_H);
    expect(vp.visible).toBe(true);
    expect(vp.y).toBe(CANVAS_H - 100);
  });
});

describe('cellTextureKey', () => {
  it('separates drum tom styles', () => {
    expect(cellTextureKey('drums', 'square')).toBe('drums:square');
    expect(cellTextureKey('drums', 'round')).toBe('drums:round');
    expect(cellTextureKey('drums', 'square')).not.toBe(
      cellTextureKey('drums', 'round'),
    );
  });

  it('ignores tomStyle for non-drum instruments', () => {
    expect(cellTextureKey('guitar', 'square')).toBe('guitar');
    expect(cellTextureKey('guitar', 'square')).toBe(
      cellTextureKey('guitar', 'round'),
    );
  });

  it('keys note-less scopes as none', () => {
    expect(cellTextureKey(null, 'square')).toBe('none');
  });

  it('shares one key across identical drum cells (the /difficulties case)', () => {
    const keys = new Set(
      Array.from({length: 10}, () => cellTextureKey('drums', 'square')),
    );
    expect(keys.size).toBe(1);
  });
});
