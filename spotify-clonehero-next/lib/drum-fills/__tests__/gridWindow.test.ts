import {computeGridWindow} from '../library/gridWindow';

describe('computeGridWindow', () => {
  const base = {
    itemCount: 100,
    columns: 4,
    rowHeight: 200,
    viewportHeight: 600,
    overscanRows: 0,
  };

  it('returns an empty window for an empty grid', () => {
    const w = computeGridWindow({...base, itemCount: 0, scrollTop: 0});
    expect(w).toEqual({
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0,
      rowCount: 0,
    });
  });

  it('computes total height from row count and row height', () => {
    const w = computeGridWindow({...base, scrollTop: 0});
    // 100 items / 4 cols = 25 rows * 200px
    expect(w.rowCount).toBe(25);
    expect(w.totalHeight).toBe(5000);
  });

  it('renders only the visible rows at the top with no overscan', () => {
    const w = computeGridWindow({...base, scrollTop: 0});
    // viewport 600 / 200 = rows 0..3 visible (3 fully + boundary) -> endRow 4
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(16); // 4 rows * 4 cols
    expect(w.paddingTop).toBe(0);
    expect(w.paddingBottom).toBe((25 - 4) * 200);
  });

  it('windows to the middle on scroll', () => {
    const w = computeGridWindow({...base, scrollTop: 2000});
    // firstVisibleRow = 10, lastVisibleRow = floor(2600/200)=13, endRow 14
    expect(w.startIndex).toBe(10 * 4);
    expect(w.endIndex).toBe(14 * 4);
    expect(w.paddingTop).toBe(10 * 200);
    expect(w.paddingBottom).toBe((25 - 14) * 200);
  });

  it('applies overscan rows above and below', () => {
    const w = computeGridWindow({...base, scrollTop: 2000, overscanRows: 2});
    expect(w.startIndex).toBe(8 * 4); // 10 - 2
    expect(w.endIndex).toBe(16 * 4); // 14 + 2
    expect(w.paddingTop).toBe(8 * 200);
  });

  it('clamps overscan at the top edge', () => {
    const w = computeGridWindow({...base, scrollTop: 0, overscanRows: 5});
    expect(w.startIndex).toBe(0);
    expect(w.paddingTop).toBe(0);
  });

  it('clamps the end at the last row and never over-pads', () => {
    const w = computeGridWindow({...base, scrollTop: 100000, overscanRows: 2});
    expect(w.endIndex).toBe(100);
    expect(w.paddingBottom).toBe(0);
    expect(
      w.paddingTop + (w.endIndex - w.startIndex) * 0 + w.paddingBottom,
    ).toBe(w.paddingTop);
  });

  it('handles a partial final row (itemCount not divisible by columns)', () => {
    const w = computeGridWindow({
      ...base,
      itemCount: 10,
      columns: 4,
      scrollTop: 100000,
    });
    // 10 / 4 = 3 rows (last row has 2 items). endIndex clamps to itemCount.
    expect(w.rowCount).toBe(3);
    expect(w.endIndex).toBe(10);
    expect(w.paddingBottom).toBe(0);
  });

  it('treats a single column as a list', () => {
    const w = computeGridWindow({
      ...base,
      columns: 1,
      itemCount: 50,
      scrollTop: 0,
    });
    expect(w.rowCount).toBe(50);
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(4); // 4 visible rows, 1 col each
  });

  it('guards against zero/invalid inputs', () => {
    const w = computeGridWindow({
      itemCount: 20,
      columns: 0,
      rowHeight: 0,
      scrollTop: -100,
      viewportHeight: -50,
    });
    expect(w.startIndex).toBe(0);
    expect(w.rowCount).toBe(20); // columns clamped to 1
    expect(Number.isFinite(w.totalHeight)).toBe(true);
  });
});
