import {buildRhythmSketch, type SketchInput} from '../library/rhythmSketch';

const base: SketchInput = {
  subdivision: '16ths',
  lengthBars: 1,
  voicingTags: ['toms', 'crash-end'],
  complexity: 4,
};

describe('buildRhythmSketch', () => {
  it('sets columns from subdivision and bars', () => {
    expect(buildRhythmSketch({...base, subdivision: '8ths'}).columns).toBe(8);
    expect(buildRhythmSketch({...base, subdivision: '16ths'}).columns).toBe(16);
    expect(buildRhythmSketch({...base, subdivision: 'triplets'}).columns).toBe(
      12,
    );
    expect(
      buildRhythmSketch({...base, subdivision: '16ths', lengthBars: 2}).columns,
    ).toBe(32);
  });

  it('caps bars at 2 and floors at 1', () => {
    expect(
      buildRhythmSketch({...base, subdivision: '8ths', lengthBars: 4}).columns,
    ).toBe(16);
    expect(
      buildRhythmSketch({...base, subdivision: '8ths', lengthBars: 0.5})
        .columns,
    ).toBe(8);
  });

  it('every lane has exactly `columns` cells', () => {
    const sketch = buildRhythmSketch({...base, lengthBars: 2});
    for (const lane of sketch.lanes) {
      expect(lane.cells).toHaveLength(sketch.columns);
    }
  });

  it('adds a crash lane with a single hit on the final downbeat when crash-end', () => {
    const sketch = buildRhythmSketch({
      ...base,
      lengthBars: 2,
      voicingTags: ['toms', 'crash-end'],
    });
    const crash = sketch.lanes.find(l => l.voice === 'crash');
    expect(crash).toBeDefined();
    const hitCols = crash!.cells.flatMap((c, i) => (c ? [i] : []));
    // Final bar's first cell.
    expect(hitCols).toEqual([sketch.columns - sketch.cellsPerBar]);
  });

  it('omits crash lane without crash-end', () => {
    const sketch = buildRhythmSketch({...base, voicingTags: ['toms']});
    expect(sketch.lanes.some(l => l.voice === 'crash')).toBe(false);
  });

  it('snare-only voicing produces just snare (+ crash if tagged)', () => {
    const sketch = buildRhythmSketch({...base, voicingTags: ['snare-only']});
    expect(sketch.lanes.map(l => l.voice).sort()).toEqual(['snare']);
  });

  it('includes a kick lane when kick-woven', () => {
    const sketch = buildRhythmSketch({
      ...base,
      voicingTags: ['toms', 'kick-woven'],
    });
    expect(sketch.lanes.some(l => l.voice === 'kick')).toBe(true);
  });

  it('lanes are ordered crash, tom, snare, kick top-to-bottom', () => {
    const sketch = buildRhythmSketch({
      ...base,
      voicingTags: ['toms', 'crash-end', 'kick-woven'],
    });
    const order = sketch.lanes.map(l => l.voice);
    const expectedOrder = ['crash', 'tom', 'snare', 'kick'];
    const filtered = expectedOrder.filter(v => order.includes(v as never));
    expect(order).toEqual(filtered);
  });

  it('higher complexity yields more hits than lower', () => {
    const low = buildRhythmSketch({
      ...base,
      complexity: 1,
      voicingTags: ['toms'],
    });
    const high = buildRhythmSketch({
      ...base,
      complexity: 5,
      voicingTags: ['toms'],
    });
    const count = (s: ReturnType<typeof buildRhythmSketch>) =>
      s.lanes.reduce((n, l) => n + l.cells.filter(Boolean).length, 0);
    expect(count(high)).toBeGreaterThan(count(low));
  });

  it('always produces at least one melodic lane', () => {
    const sketch = buildRhythmSketch({...base, voicingTags: ['crash-end']});
    expect(sketch.lanes.some(l => l.voice !== 'crash')).toBe(true);
  });

  it('is deterministic', () => {
    expect(buildRhythmSketch(base)).toEqual(buildRhythmSketch(base));
  });
});
