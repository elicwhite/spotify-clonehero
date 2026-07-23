import type {ChartDocument} from '@eliwhite/scan-chart';
import type {Track} from '../../preview/highway/types';
import {mergeOursTiersIntoChart} from '../exportChart';

function fakeTrack(instrument: string, difficulty: string): Track {
  return {
    instrument,
    difficulty,
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
  } as unknown as Track;
}

function fakeChartDoc(trackData: Track[]): ChartDocument {
  return {
    parsedChart: {
      trackData,
    } as unknown as ChartDocument['parsedChart'],
    assets: [],
  };
}

describe('mergeOursTiersIntoChart', () => {
  const oursTracks: Record<'hard' | 'medium' | 'easy', Track> = {
    hard: fakeTrack('drums', 'hard'),
    medium: fakeTrack('drums', 'medium'),
    easy: fakeTrack('drums', 'easy'),
  };

  test('keeps the Expert drums track and other instruments, replaces existing non-Expert drums tracks', () => {
    const expertDrums = fakeTrack('drums', 'expert');
    const oldHardDrums = fakeTrack('drums', 'hard'); // e.g. a Harmonix-charted upload's own
    const guitarHard = fakeTrack('guitar', 'hard');
    const guitarExpert = fakeTrack('guitar', 'expert');
    const chartDoc = fakeChartDoc([
      expertDrums,
      oldHardDrums,
      guitarHard,
      guitarExpert,
    ]);

    const merged = mergeOursTiersIntoChart(chartDoc, oursTracks);

    expect(merged.parsedChart.trackData).toEqual([
      expertDrums,
      guitarHard,
      guitarExpert,
      oursTracks.hard,
      oursTracks.medium,
      oursTracks.easy,
    ]);
  });

  test('does not mutate the input chart document', () => {
    const chartDoc = fakeChartDoc([fakeTrack('drums', 'expert')]);
    const originalTrackData = chartDoc.parsedChart.trackData;

    mergeOursTiersIntoChart(chartDoc, oursTracks);

    expect(chartDoc.parsedChart.trackData).toBe(originalTrackData);
    expect(chartDoc.parsedChart.trackData).toHaveLength(1);
  });

  test('handles a chart with no existing non-Expert drums tracks', () => {
    const expertDrums = fakeTrack('drums', 'expert');
    const chartDoc = fakeChartDoc([expertDrums]);

    const merged = mergeOursTiersIntoChart(chartDoc, oursTracks);

    expect(merged.parsedChart.trackData).toEqual([
      expertDrums,
      oursTracks.hard,
      oursTracks.medium,
      oursTracks.easy,
    ]);
  });
});
