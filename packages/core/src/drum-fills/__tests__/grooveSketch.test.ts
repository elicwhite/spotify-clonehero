import {buildGrooveSketch} from '../library/rhythmSketch';

// Voice bitmask (must mirror grooveFingerprint.ts):
// kick=1, snare=2, hat=4, tom=8, crash=16.
const KICK = 1;
const SNARE = 2;
const HAT = 4;
const TOM = 8;
const CRASH = 16;

describe('buildGrooveSketch', () => {
  it('returns an empty sketch for an empty fingerprint', () => {
    const sketch = buildGrooveSketch('');
    expect(sketch.lanes).toHaveLength(0);
    expect(sketch.columns).toBe(16);
  });

  it('renders one lane per voice present, in canonical order', () => {
    // slot 0: kick+hat, slot 12: snare+hat, slot 24: kick, slot 36: snare.
    const fp = `0:${KICK | HAT}|12:${SNARE | HAT}|24:${KICK}|36:${SNARE}`;
    const sketch = buildGrooveSketch(fp);
    expect(sketch.lanes.map(l => l.voice)).toEqual(['hat', 'snare', 'kick']);
  });

  it('places onsets on the folded 16th grid (48 fine slots → 16 cells)', () => {
    // Fine slots 0,12,24,36 (quarter notes) fold to cells 0,4,8,12.
    const fp = `0:${KICK}|12:${KICK}|24:${KICK}|36:${KICK}`;
    const sketch = buildGrooveSketch(fp);
    const kick = sketch.lanes.find(l => l.voice === 'kick')!;
    const onCols = kick.cells.flatMap((c, i) => (c ? [i] : []));
    expect(onCols).toEqual([0, 4, 8, 12]);
  });

  it('every lane has exactly 16 cells', () => {
    const fp = `0:${KICK | SNARE | HAT | TOM | CRASH}`;
    const sketch = buildGrooveSketch(fp);
    expect(sketch.lanes).toHaveLength(5);
    for (const lane of sketch.lanes) {
      expect(lane.cells).toHaveLength(16);
    }
  });

  it('clamps an out-of-range slot to the last cell', () => {
    const fp = `47:${SNARE}`;
    const sketch = buildGrooveSketch(fp);
    const snare = sketch.lanes.find(l => l.voice === 'snare')!;
    // 47/3 = 15.67 → round 16 → clamped to 15.
    expect(snare.cells[15]).toBe(true);
  });

  it('ignores malformed tokens', () => {
    const sketch = buildGrooveSketch('garbage|0:2|:|x:y');
    expect(sketch.lanes.map(l => l.voice)).toEqual(['snare']);
  });

  it('is deterministic', () => {
    const fp = `0:${KICK}|8:${SNARE | HAT}`;
    expect(buildGrooveSketch(fp)).toEqual(buildGrooveSketch(fp));
  });
});
