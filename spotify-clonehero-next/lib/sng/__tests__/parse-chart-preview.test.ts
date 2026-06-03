import {describe, test, expect} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';
import {parseChartPreview} from '../parse-chart-preview';
import type {FileEntry} from '@/lib/chart-export';

const drumsChart = readFileSync(
  join(__dirname, '../../chart-edit/__tests__/fixtures/drums-basic.chart'),
);

describe('parseChartPreview', () => {
  test('returns null when there is no chart file', () => {
    const files: FileEntry[] = [
      {fileName: 'song.opus', data: new Uint8Array([1, 2, 3])},
      {fileName: 'album.png', data: new Uint8Array([4, 5, 6])},
    ];
    expect(parseChartPreview(files)).toBeNull();
  });

  test('parses metadata and per-instrument difficulties from a .chart', () => {
    const files: FileEntry[] = [
      {fileName: 'notes.chart', data: new Uint8Array(drumsChart)},
      {fileName: 'song.opus', data: new Uint8Array([1, 2, 3])},
    ];

    const preview = parseChartPreview(files);
    expect(preview).not.toBeNull();
    expect(preview!.name).toBe('Test Chart Song');
    expect(preview!.artist).toBe('Test Artist');
    expect(preview!.charter).toBe('TestCharter');

    // The fixture only has an [ExpertDrums] track.
    expect(preview!.instruments).toEqual([
      {instrument: 'drums', difficulties: ['expert']},
    ]);

    // No album art file in this fixture.
    expect(preview!.albumArt).toBeUndefined();
  });

  test('strips Clone Hero rich-text tags from name, artist, and charter', () => {
    const chart = [
      '[Song]',
      '{',
      '  Name = "<color=#ff0038>Hello</color>"',
      '  Artist = "<b>World</b>"',
      '  Charter = "<color=#a5002c>M</color><color=#ff0038>i</color>"',
      '  Resolution = 192',
      '}',
      '[SyncTrack]',
      '{',
      '  0 = TS 4',
      '  0 = B 120000',
      '}',
      '[ExpertDrums]',
      '{',
      '  0 = N 0 0',
      '}',
    ].join('\n');

    const preview = parseChartPreview([
      {fileName: 'notes.chart', data: new TextEncoder().encode(chart)},
    ]);

    expect(preview).not.toBeNull();
    expect(preview!.name).toBe('Hello');
    expect(preview!.artist).toBe('World');
    expect(preview!.charter).toBe('Mi');
  });
});
