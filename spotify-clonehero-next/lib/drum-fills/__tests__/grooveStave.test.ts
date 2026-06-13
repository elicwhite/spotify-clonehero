import {grooveStaveCells} from '../library/grooveStave';

// kick=1 snare=2 hat=4 (48/bar slots).
// Straight-8ths backbeat: onsets only on 8th positions (slots 0,6,12,...).
const BACKBEAT_8THS = '0:5|6:4|12:6|18:4|24:5|30:4|36:6|42:4';
// A 16th-note hat hit added off the 8th grid (slot 3).
const WITH_16TH = '0:5|3:4|6:4|12:6';

describe('grooveStaveCells', () => {
  it('returns empty for an unparseable fingerprint', () => {
    expect(grooveStaveCells('')).toEqual({cellsPerBar: 0, cells: []});
  });

  it('collapses a purely-8th groove to an 8-cell grid', () => {
    const {cellsPerBar, cells} = grooveStaveCells(BACKBEAT_8THS);
    expect(cellsPerBar).toBe(8);
    expect(cells).toHaveLength(8);
    // Beat 1 (cell 0): kick + hat.
    expect(cells[0].sort()).toEqual(['hat', 'kick']);
    // Beat 2 (cell 2): snare + hat.
    expect(cells[2].sort()).toEqual(['hat', 'snare']);
  });

  it('keeps a 16-cell grid when an onset lands off the 8th grid', () => {
    const {cellsPerBar, cells} = grooveStaveCells(WITH_16TH);
    expect(cellsPerBar).toBe(16);
    expect(cells).toHaveLength(16);
    expect(cells[1]).toEqual(['hat']); // the slot-3 16th hat
  });
});
