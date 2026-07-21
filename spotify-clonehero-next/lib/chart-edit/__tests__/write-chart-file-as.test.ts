import type {ChartDocument} from '../types';
import {
  addDrumNote,
  createEmptyChart,
  getDrumNotes,
  readChart,
  writeChartFileAs,
} from '../index';
import {noteTypes} from '@eliwhite/scan-chart';
import {emptyTrackData} from './test-utils';

function createChart(format: 'chart' | 'mid'): ChartDocument {
  const parsedChart = createEmptyChart({bpm: 120, resolution: 480, format});
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  return {parsedChart, assets: []};
}

/** Recursively `Object.freeze`s every object/array reachable from `value`,
 * so any downstream mutation attempt throws in strict mode (Jest's default
 * for ESM/TS test files) instead of silently passing. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

describe('writeChartFileAs', () => {
  it('same-format passthrough uses the expected notes.chart name', () => {
    const doc = createChart('chart');
    const result = writeChartFileAs(doc, 'chart');
    expect(result.fileName).toBe('notes.chart');
  });

  it('same-format passthrough uses the expected notes.mid name', () => {
    const doc = createChart('mid');
    const result = writeChartFileAs(doc, 'mid');
    expect(result.fileName).toBe('notes.mid');
  });

  it('converts chart -> mid', () => {
    const doc = createChart('chart');
    const result = writeChartFileAs(doc, 'mid');
    expect(result.fileName).toBe('notes.mid');
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('converts mid -> chart', () => {
    const doc = createChart('mid');
    const result = writeChartFileAs(doc, 'chart');
    expect(result.fileName).toBe('notes.chart');
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('does not mutate the input doc', () => {
    const doc = createChart('chart');
    const expert = doc.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (!expert) throw new Error('expected an empty expert drums track');
    addDrumNote(expert, {tick: 0, type: noteTypes.kick});

    // Deep-freeze the whole doc so any mutation attempt — not just to
    // `format`, but to trackData, notes, metadata, etc. — throws in strict
    // mode instead of passing silently.
    deepFreeze(doc);

    expect(() => writeChartFileAs(doc, 'mid')).not.toThrow();
    expect(doc.parsedChart.format).toBe('chart');
  });

  it('round-trips drum notes through a chart -> mid conversion', () => {
    const doc = createChart('chart');
    const expert = doc.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (!expert) throw new Error('expected an empty expert drums track');
    addDrumNote(expert, {tick: 0, type: noteTypes.kick});
    addDrumNote(expert, {tick: 480, type: noteTypes.redDrum});

    const midFile = writeChartFileAs(doc, 'mid');
    const reparsedDoc = readChart([midFile]);
    const reparsedExpert = reparsedDoc.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (!reparsedExpert) throw new Error('expected drums track to survive');

    expect(
      getDrumNotes(reparsedExpert)
        .map(n => n.tick)
        .sort(),
    ).toEqual([0, 480]);
  });

  it('round-trips drum notes through a mid -> chart conversion', () => {
    const doc = createChart('mid');
    const expert = doc.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (!expert) throw new Error('expected an empty expert drums track');
    addDrumNote(expert, {tick: 0, type: noteTypes.kick});
    addDrumNote(expert, {tick: 480, type: noteTypes.redDrum});

    const chartFile = writeChartFileAs(doc, 'chart');
    const reparsedDoc = readChart([chartFile]);
    const reparsedExpert = reparsedDoc.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (!reparsedExpert) throw new Error('expected drums track to survive');

    expect(
      getDrumNotes(reparsedExpert)
        .map(n => n.tick)
        .sort(),
    ).toEqual([0, 480]);
  });
});
