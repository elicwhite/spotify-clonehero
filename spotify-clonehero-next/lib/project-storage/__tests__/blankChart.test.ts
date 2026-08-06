import {writeChartFolder} from '@/lib/chart-edit';
import {scanIni} from '@eliwhite/scan-chart';

import {
  createBlankChartDocument,
  DEFAULT_BLANK_SONG_LENGTH_MS,
} from '../blankChart';

describe('createBlankChartDocument', () => {
  it('is one empty Expert Drums track on a 120 BPM 4/4 grid', () => {
    const {parsedChart} = createBlankChartDocument({name: 'Blank'});

    expect(parsedChart.format).toBe('chart');
    expect(parsedChart.trackData).toHaveLength(1);
    expect(parsedChart.trackData[0].instrument).toBe('drums');
    expect(parsedChart.trackData[0].difficulty).toBe('expert');
    expect(parsedChart.trackData[0].noteEventGroups).toEqual([]);
    expect(parsedChart.tempos).toHaveLength(1);
    expect(parsedChart.tempos[0].beatsPerMinute).toBe(120);
    expect(parsedChart.timeSignatures).toHaveLength(1);
    expect(parsedChart.timeSignatures[0].numerator).toBe(4);
    expect(parsedChart.timeSignatures[0].denominator).toBe(4);
    expect(parsedChart.metadata.song_length).toBe(DEFAULT_BLANK_SONG_LENGTH_MS);
  });

  it('emits a song.ini carrying the identity and the length', () => {
    const doc = createBlankChartDocument({
      name: 'Blank',
      artist: 'Nobody',
      charter: 'Me',
      songLengthMs: 200_000,
    });
    const files = writeChartFolder(doc);
    expect(files.map(f => f.fileName).sort()).toEqual([
      'notes.chart',
      'song.ini',
    ]);

    const ini = files.find(f => f.fileName === 'song.ini')!;
    const scanned = scanIni([ini]);
    expect(scanned.metadata?.name).toBe('Blank');
    expect(scanned.metadata?.artist).toBe('Nobody');
    expect(scanned.metadata?.charter).toBe('Me');
    expect(scanned.metadata?.song_length).toBe(200_000);
  });
});
