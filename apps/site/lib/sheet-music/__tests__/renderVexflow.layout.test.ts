import {layoutMeasures} from '../renderVexflow';

describe('layoutMeasures', () => {
  it('gives every measure one slot when all of them fit', () => {
    expect(layoutMeasures([100, 200, 300, 100, 50], 300, 2)).toEqual([
      {row: 0, x: 0, width: 300},
      {row: 0, x: 300, width: 300},
      {row: 1, x: 0, width: 300},
      {row: 1, x: 300, width: 300},
      {row: 2, x: 0, width: 300},
    ]);
  });

  it('widens a crowded measure and moves what no longer fits to the next row', () => {
    const slots = layoutMeasures([100, 100, 500, 100, 100, 100], 300, 3);

    expect(slots.map(s => s.row)).toEqual([0, 0, 1, 1, 2, 2]);
    // Row 1 holds the 500-wide measure and one normal one, stretched to 900.
    expect(slots[2]).toEqual({row: 1, x: 0, width: 562.5});
    expect(slots[3]).toEqual({row: 1, x: 562.5, width: 337.5});
    // Row 0 is stretched to fill; the short last row keeps natural widths.
    expect(slots[0].width).toBe(450);
    expect(slots[5]).toEqual({row: 2, x: 300, width: 300});
  });

  it('never makes a measure wider than a row', () => {
    expect(layoutMeasures([2000], 300, 2)).toEqual([
      {row: 0, x: 0, width: 600},
    ]);
  });
});
