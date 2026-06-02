import {describe, test, expect} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';
import {
  parseChartPreview,
  findAlbumArt,
  type PreviewFile,
} from '../parse-chart-preview';

const drumsChart = readFileSync(
  join(__dirname, '../../chart-edit/__tests__/fixtures/drums-basic.chart'),
);

describe('parseChartPreview', () => {
  test('returns null when there is no chart file', () => {
    const files: PreviewFile[] = [
      {fileName: 'song.opus', data: new Uint8Array([1, 2, 3])},
      {fileName: 'album.png', data: new Uint8Array([4, 5, 6])},
    ];
    expect(parseChartPreview(files)).toBeNull();
  });

  test('parses metadata and per-instrument difficulties from a .chart', () => {
    const files: PreviewFile[] = [
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
  });
});

describe('findAlbumArt', () => {
  test('finds album.png / album.jpg case-insensitively', () => {
    expect(
      findAlbumArt([{fileName: 'Album.PNG', data: new Uint8Array()}])?.fileName,
    ).toBe('Album.PNG');
    expect(
      findAlbumArt([{fileName: 'album.jpg', data: new Uint8Array()}])?.fileName,
    ).toBe('album.jpg');
  });

  test('returns undefined when no album art is present', () => {
    expect(
      findAlbumArt([{fileName: 'background.png', data: new Uint8Array()}]),
    ).toBeUndefined();
  });
});
