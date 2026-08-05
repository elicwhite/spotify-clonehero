/**
 * The song-details editor's `song.ini` fields must survive assembly.
 *
 * `album`, `genre`, `year` and the `diff_*` family are supplied as
 * {@link ChartPackageMetadata} at export time; assembly stamps them onto the
 * parsed chart before `writeChartFolder` regenerates `song.ini`. These tests
 * read the emitted `song.ini` back with this project's ini parser, which is
 * the file a chart manager actually reads.
 */

import {describe, test, expect} from '@jest/globals';
import type {File as FileEntry} from '@eliwhite/scan-chart';

import {createEmptyChart, writeChartFolder} from '@/lib/chart-edit';
import {parse as parseIni, $NoSection} from '@/lib/ini-parser';

import {assembleChartFiles, type ChartPackageMetadata} from '../assemble';

function chartFile(): FileEntry {
  const files = writeChartFolder({
    parsedChart: createEmptyChart({
      format: 'chart',
      resolution: 192,
      bpm: 120,
      timeSignature: {numerator: 4, denominator: 4},
    }),
    assets: [],
  });
  const notes = files.find(f => f.fileName === 'notes.chart');
  if (!notes) throw new Error('writeChartFolder produced no notes.chart');
  return notes;
}

/** The `[song]` section of the assembled package's `song.ini`. */
function assembledIni(metadata: ChartPackageMetadata): Record<string, string> {
  const entries = assembleChartFiles({chartFile: chartFile(), metadata});
  const ini = entries.find(f => f.fileName === 'song.ini');
  expect(ini).toBeDefined();
  const {iniObject, iniErrors} = parseIni(
    new TextDecoder().decode(ini!.data as Uint8Array),
  );
  expect(iniErrors).toEqual([]);
  return iniObject['song'] ?? iniObject[$NoSection] ?? {};
}

describe('assembleChartFiles song.ini fields', () => {
  test('writes album, genre and year', () => {
    const song = assembledIni({
      name: 'Test Song',
      artist: 'Test Artist',
      charter: 'Test Charter',
      album: 'Test Album',
      genre: 'Progressive Metal',
      year: '2004',
    });

    expect(song['name']).toBe('Test Song');
    expect(song['artist']).toBe('Test Artist');
    expect(song['charter']).toBe('Test Charter');
    expect(song['album']).toBe('Test Album');
    expect(song['genre']).toBe('Progressive Metal');
    expect(song['year']).toBe('2004');
  });

  test('writes per-instrument diff_* intensities', () => {
    const song = assembledIni({
      name: 'Test Song',
      artist: 'Test Artist',
      charter: 'Test Charter',
      difficulties: {
        diff_drums: 5,
        diff_drums_real: 5,
        diff_guitar: 3,
        diff_bass: 2,
      },
    });

    expect(song['diff_drums']).toBe('5');
    expect(song['diff_drums_real']).toBe('5');
    expect(song['diff_guitar']).toBe('3');
    expect(song['diff_bass']).toBe('2');
  });

  test('an explicit intensity overrides the drums default', () => {
    const song = assembledIni({
      name: 'Test Song',
      artist: 'Test Artist',
      charter: 'Test Charter',
      difficulties: {diff_drums: 6, diff_drums_real: 6},
    });
    expect(song['diff_drums']).toBe('6');
    expect(song['diff_drums_real']).toBe('6');
  });

  test('the -1 unset sentinel is written through rather than clamped', () => {
    const song = assembledIni({
      name: 'Test Song',
      artist: 'Test Artist',
      charter: 'Test Charter',
      difficulties: {diff_guitar: -1},
    });
    // -1 is scan-chart's default for diff_guitar, so an explicitly-unset
    // field is simply absent from the emitted ini, which is what "not set"
    // means in the song.ini spec.
    expect(song['diff_guitar']).toBeUndefined();
  });

  test('omitting the new fields leaves the existing behavior untouched', () => {
    const song = assembledIni({
      name: 'Test Song',
      artist: 'Test Artist',
      charter: '',
    });
    expect(song['charter']).toBe('MusicCharts.tools');
    expect(song['album']).toBeUndefined();
    expect(song['genre']).toBeUndefined();
    // The fixture chart has no drums track, so it is not declared as rated
    // Pro Drums. `assemble-roundtrip` covers the chart that does.
    expect(song['pro_drums']).toBeUndefined();
  });
});
