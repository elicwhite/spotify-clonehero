/**
 * Exporting must never clobber a `song.ini` field this project does not edit.
 *
 * A chart in the wild declares far more than the song-details dialog offers:
 * a keys difficulty, `icon`, `loading_phrase`, `preview_start_time`,
 * `album_track`, and any custom key its charter invented (scan-chart surfaces
 * those last as `metadata.extraIniFields`). Assembly regenerates `song.ini`
 * wholesale, so the contract is round-trip fidelity: parse a package, assemble
 * it back, and every field the caller did not name comes out exactly as it
 * went in.
 */

import {describe, test, expect} from '@jest/globals';

import {readChart, writeChartFolder, createEmptyChart} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {parse as parseIni, $NoSection} from '@/lib/ini-parser';
import type {ChartDocument} from '@/lib/chart-edit';

import {assembleChartFiles} from '../assemble';

/** A `song.ini` with one field from every category assembly could clobber:
 *  edited (`diff_guitar`), read-but-not-edited (`diff_keys`), known but never
 *  read (`icon`, `loading_phrase`, `preview_start_time`, `album_track`), and
 *  entirely unknown (`banner_link_a`, `custom_charter_field`). */
const SOURCE_INI = [
  '[song]',
  'name = Placeholder Title',
  'artist = Placeholder Artist',
  'charter = Placeholder Charter',
  'album = Placeholder Album',
  'genre = Rock',
  'year = 2004',
  'diff_guitar = 3',
  'diff_bass = 2',
  'diff_keys = 4',
  'icon = someicon',
  'loading_phrase = Mind the gap',
  'preview_start_time = 57260',
  'album_track = 7',
  'playlist_track = 16000',
  'banner_link_a = http://example.invalid/',
  'custom_charter_field = keep me',
  '',
].join('\n');

/** A parsed chart package: a `.chart` file with a guitar and a drums track,
 *  plus {@link SOURCE_INI}. */
function sourceDocument(): ChartDocument {
  const chart = createEmptyChart({
    format: 'chart',
    resolution: 192,
    bpm: 120,
    timeSignature: {numerator: 4, denominator: 4},
  });
  const written = writeChartFolder({
    parsedChart: {
      ...chart,
      trackData: [
        emptyTrackData('guitar', 'expert'),
        emptyTrackData('drums', 'expert'),
      ],
    },
    assets: [],
  });
  const notes = written.find(f => f.fileName === 'notes.chart');
  if (!notes) throw new Error('writeChartFolder produced no notes.chart');
  return readChart([
    notes,
    {fileName: 'song.ini', data: new TextEncoder().encode(SOURCE_INI)},
  ]);
}

/** The `[song]` section of an assembled package's `song.ini`. */
function assembledIni(entries: {fileName: string; data: Uint8Array}[]) {
  const ini = entries.find(f => f.fileName === 'song.ini');
  if (!ini) throw new Error('assembly produced no song.ini');
  const {iniObject, iniErrors} = parseIni(new TextDecoder().decode(ini.data));
  expect(iniErrors).toEqual([]);
  return iniObject['song'] ?? iniObject[$NoSection] ?? {};
}

/** Assemble a package from `doc` and parse it back the way a chart manager
 *  would, so the comparison is on values rather than on ini formatting. */
function reparsed(doc: ChartDocument) {
  const entries = assembleChartFiles({
    chartDoc: doc,
    metadata: {name: 'A', artist: 'B', charter: 'C'},
  });
  return readChart(
    entries.map(f => ({fileName: f.fileName, data: f.data as Uint8Array})),
  ).parsedChart.metadata;
}

describe('assembleChartFiles preserves untouched song.ini fields', () => {
  test('a round trip leaves every field the caller did not name identical', () => {
    const doc = sourceDocument();
    const before = assembledIni(
      writeChartFolder(doc).map(f => ({
        fileName: f.fileName,
        data: f.data as Uint8Array,
      })),
    );

    const after = assembledIni(
      assembleChartFiles({
        chartDoc: doc,
        metadata: {
          name: 'Placeholder Title',
          artist: 'Placeholder Artist',
          charter: 'Placeholder Charter',
          difficulties: {diff_guitar: 5},
        },
      }) as {fileName: string; data: Uint8Array}[],
    );

    // The one field the caller named is the one field that moved.
    expect(before['diff_guitar']).toBe('3');
    expect(after['diff_guitar']).toBe('5');
    for (const key of Object.keys(before)) {
      if (key === 'diff_guitar' || key === 'song_length') continue;
      expect([key, after[key]]).toEqual([key, before[key]]);
    }
  });

  test('keeps a keys difficulty the editor offers no row for', () => {
    const song = assembledIni(
      assembleChartFiles({
        chartDoc: sourceDocument(),
        metadata: {name: 'A', artist: 'B', charter: 'C'},
      }) as {fileName: string; data: Uint8Array}[],
    );
    expect(song['diff_keys']).toBe('4');
    expect(song['diff_bass']).toBe('2');
  });

  test('keeps known fields nothing in this project reads', () => {
    const song = assembledIni(
      assembleChartFiles({
        chartDoc: sourceDocument(),
        metadata: {name: 'A', artist: 'B', charter: 'C'},
      }) as {fileName: string; data: Uint8Array}[],
    );
    expect(song['icon']).toBe('someicon');
    expect(song['loading_phrase']).toBe('Mind the gap');
    expect(song['preview_start_time']).toBe('57260');
    expect(song['album_track']).toBe('7');
  });

  test('a field holding scan-chart’s own default reads back unchanged', () => {
    // `playlist_track = 16000` IS scan-chart's default, so the writer omits
    // the line. The value a chart manager reads is identical either way, which
    // is what "untouched" has to mean for a regenerated ini.
    const doc = sourceDocument();
    expect(doc.parsedChart.metadata.playlist_track).toBe(16000);
    expect(reparsed(doc).playlist_track).toBe(16000);
  });

  test('keeps unknown custom keys, which ride in extraIniFields', () => {
    const doc = sourceDocument();
    expect(doc.parsedChart.metadata.extraIniFields).toEqual({
      banner_link_a: 'http://example.invalid/',
      custom_charter_field: 'keep me',
    });

    const song = assembledIni(
      assembleChartFiles({
        chartDoc: doc,
        metadata: {name: 'A', artist: 'B', charter: 'C'},
      }) as {fileName: string; data: Uint8Array}[],
    );
    expect(song['banner_link_a']).toBe('http://example.invalid/');
    expect(song['custom_charter_field']).toBe('keep me');
  });

  test('does not advertise rated Pro Drums on a chart with no drums track', () => {
    const chart = createEmptyChart({
      format: 'chart',
      resolution: 192,
      bpm: 120,
      timeSignature: {numerator: 4, denominator: 4},
    });
    const song = assembledIni(
      assembleChartFiles({
        chartDoc: {
          parsedChart: {
            ...chart,
            trackData: [emptyTrackData('guitar', 'expert')],
          },
          assets: [],
        },
        metadata: {name: 'A', artist: 'B', charter: 'C'},
      }) as {fileName: string; data: Uint8Array}[],
    );

    expect(song['pro_drums']).toBeUndefined();
    expect(song['diff_drums']).toBeUndefined();
    expect(song['diff_drums_real']).toBeUndefined();
  });

  test('still declares rated Pro Drums on a chart that has drums', () => {
    const song = assembledIni(
      assembleChartFiles({
        chartDoc: sourceDocument(),
        metadata: {name: 'A', artist: 'B', charter: 'C'},
      }) as {fileName: string; data: Uint8Array}[],
    );
    expect(song['pro_drums']).toBe('True');
    expect(song['diff_drums']).toBe('0');
  });
});
