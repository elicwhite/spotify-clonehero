import {describe, test, expect, jest} from '@jest/globals';
import {
  convertChartFolders,
  selectChartFoldersToConvert,
  sngFileNameForFolder,
} from '../convert-folder-to-sng';
import type {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';

/** Build a minimal SongAccumulator-shaped entry for selection tests. */
function chart(fileName: string): SongAccumulator {
  return {
    artist: 'Artist',
    song: 'Song',
    modifiedTime: '',
    charter: '',
    genre: '',
    data: {name: 'Song', artist: 'Artist', charter: ''},
    file: '',
    handleInfo: {
      // Only fileName is read by selectChartFoldersToConvert.
      parentDir: {} as FileSystemDirectoryHandle,
      fileName,
    },
  } as SongAccumulator;
}

describe('selectChartFoldersToConvert', () => {
  test('keeps folder charts and drops existing .sng charts', () => {
    const charts = [
      chart('Artist - Song (Charter)'),
      chart('Already Packaged.sng'),
      chart('Another Folder'),
    ];
    expect(selectChartFoldersToConvert(charts).map(c => c.handleInfo.fileName)).toEqual([
      'Artist - Song (Charter)',
      'Another Folder',
    ]);
  });

  test('matches the .sng extension case-insensitively', () => {
    const charts = [chart('LOUD.SNG'), chart('quiet.Sng'), chart('folder')];
    expect(
      selectChartFoldersToConvert(charts).map(c => c.handleInfo.fileName),
    ).toEqual(['folder']);
  });

  test('returns an empty list when every chart is already a .sng', () => {
    expect(selectChartFoldersToConvert([chart('a.sng'), chart('b.sng')])).toEqual(
      [],
    );
  });
});

describe('sngFileNameForFolder', () => {
  test('appends the .sng extension to the folder name', () => {
    expect(sngFileNameForFolder('Artist - Song (Charter)')).toBe(
      'Artist - Song (Charter).sng',
    );
  });
});

describe('convertChartFolders', () => {
  test('converts every chart and reports the totals', async () => {
    const charts = [chart('a'), chart('b'), chart('c')];
    const convert = jest.fn(async () => {});

    const result = await convertChartFolders(charts, {convert});

    expect(convert).toHaveBeenCalledTimes(3);
    expect(result).toEqual({written: 3, failed: 0});
  });

  test('isolates failures: one bad chart does not abort the rest', async () => {
    const charts = [chart('ok-1'), chart('boom'), chart('ok-2')];
    const convert = jest.fn(async (c: SongAccumulator) => {
      if (c.handleInfo.fileName === 'boom') throw new Error('nope');
    });
    // Keep the expected console.error noise out of the test output.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await convertChartFolders(charts, {convert});

    expect(result).toEqual({written: 2, failed: 1});
    expect(convert).toHaveBeenCalledTimes(3);
    errSpy.mockRestore();
  });

  test('reports progress once per settled chart with running totals', async () => {
    const charts = [chart('a'), chart('b'), chart('c')];
    const progress: Array<{written: number; failed: number; total: number}> =
      [];

    await convertChartFolders(charts, {
      concurrency: 1, // deterministic ordering for the assertion
      convert: async () => {},
      onProgress: p => progress.push(p),
    });

    expect(progress).toEqual([
      {written: 1, failed: 0, total: 3},
      {written: 2, failed: 0, total: 3},
      {written: 3, failed: 0, total: 3},
    ]);
  });

  test('never runs more than `concurrency` conversions at once', async () => {
    const charts = Array.from({length: 10}, (_, i) => chart(`c${i}`));
    let inFlight = 0;
    let maxInFlight = 0;
    const convert = jest.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
    });

    await convertChartFolders(charts, {concurrency: 3, convert});

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(convert).toHaveBeenCalledTimes(10);
  });
});
