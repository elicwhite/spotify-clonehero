/**
 * The chart's tempo map as a LinkSeg beat source: the grid it produces has to
 * be the SAME thing Beat This! would hand LinkSeg — quarter-note times in
 * seconds spanning the audio — or the windows it builds sit on the wrong
 * music.
 */

import {addTempo, addTimeSignature, createEmptyChart} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';

import {
  chartQuarterNoteBeatTimes,
  hasMusicalTempoGrid,
} from '../chart-beat-grid';

const RESOLUTION = 480;

function chartAt(bpm: number): ChartDocument {
  return {
    parsedChart: createEmptyChart({
      format: 'chart',
      resolution: RESOLUTION,
      bpm,
      timeSignature: {numerator: 4, denominator: 4},
    }),
    assets: [],
  } as unknown as ChartDocument;
}

/** Beat times, rounded off the floating-point tail that accumulating
 *  ms-per-tick leaves behind (a beat 4e-16 s late is still that beat). */
function grid(doc: ChartDocument, durationSeconds: number): number[] {
  return chartQuarterNoteBeatTimes(
    doc.parsedChart as unknown as ParsedChart,
    durationSeconds,
  ).map(t => Math.round(t * 1e6) / 1e6);
}

describe('chartQuarterNoteBeatTimes', () => {
  it('walks quarter notes at the chart tempo, from time zero', () => {
    // 120 BPM = one quarter note every 0.5 s.
    const times = grid(chartAt(120), 2);
    expect(times).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('follows tempo changes rather than the opening tempo', () => {
    const doc = chartAt(120);
    // Double time from beat 4 (tick 1920, t=2s): 0.25 s per quarter after it.
    addTempo(doc, 4 * RESOLUTION, 240);
    expect(grid(doc, 3)).toEqual([0, 0.5, 1, 1.5, 2, 2.25, 2.5, 2.75, 3]);
  });

  it('extends past the end of the chart to cover the whole audio', () => {
    // The chart says nothing past its last tempo event, but LinkSeg reads
    // windows across the entire mix, so the grid rides the last tempo out.
    const times = grid(chartAt(120), 60);
    expect(times[times.length - 1]).toBeCloseTo(60, 3);
    expect(times).toHaveLength(121);
  });

  it('gives quarter notes in a compound meter, not the notated beat unit', () => {
    // 6/8's beat unit is an eighth note. Handing LinkSeg those would double
    // the beat count over the region; `make_grid_beats.py` used quarters.
    const doc = chartAt(120);
    addTimeSignature(doc, 0, 6, 8);
    expect(grid(doc, 2)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('returns nothing for a zero-length decode', () => {
    expect(grid(chartAt(120), 0)).toEqual([]);
  });
});

describe('hasMusicalTempoGrid', () => {
  it('rejects a blank chart: one default tempo and no notes', () => {
    const doc = chartAt(120);
    expect(hasMusicalTempoGrid(doc.parsedChart as unknown as ParsedChart)).toBe(
      false,
    );
  });

  it('accepts a chart with a tempo change', () => {
    const doc = chartAt(120);
    addTempo(doc, 4 * RESOLUTION, 132);
    expect(hasMusicalTempoGrid(doc.parsedChart as unknown as ParsedChart)).toBe(
      true,
    );
  });

  it('accepts a flat chart that has notes charted against it', () => {
    const doc = chartAt(120);
    doc.parsedChart.trackData.push({
      instrument: 'drums',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      soloSections: [],
      flexLanes: [],
      drumFreestyleSections: [],
      textEvents: [],
      versusPhrases: [],
      animations: [],
      unrecognizedMidiEvents: [],
      noteEventGroups: [
        [
          {
            tick: 0,
            length: 0,
            type: 0,
            flags: 0,
            msTime: 0,
            msLength: 0,
          },
        ],
      ],
    } as unknown as ChartDocument['parsedChart']['trackData'][number]);
    expect(hasMusicalTempoGrid(doc.parsedChart as unknown as ParsedChart)).toBe(
      true,
    );
  });

  it('rejects a chart whose only track is empty', () => {
    const doc = chartAt(120);
    doc.parsedChart.trackData.push({
      instrument: 'drums',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      soloSections: [],
      flexLanes: [],
      drumFreestyleSections: [],
      textEvents: [],
      versusPhrases: [],
      animations: [],
      unrecognizedMidiEvents: [],
      noteEventGroups: [],
    } as unknown as ChartDocument['parsedChart']['trackData'][number]);
    expect(hasMusicalTempoGrid(doc.parsedChart as unknown as ParsedChart)).toBe(
      false,
    );
  });
});
