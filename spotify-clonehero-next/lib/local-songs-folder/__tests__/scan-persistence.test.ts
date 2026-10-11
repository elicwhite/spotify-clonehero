/** @jest-environment jsdom */

import {waitFor} from '@testing-library/react';

const mockScanLocalCharts = jest.fn();
const mockUpsertLocalCharts = jest.fn<
  Promise<void>,
  [unknown[], {pruneMissing: boolean}]
>(async () => undefined);
const mockSongsDirectory = {kind: 'directory', name: 'Songs'};

jest.mock('idb-keyval', () => ({
  get: jest.fn(async () => undefined),
  set: jest.fn(async () => undefined),
}));
jest.mock('filenamify/browser', () => jest.fn());
jest.mock('../scanLocalCharts', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockScanLocalCharts(...args),
}));
jest.mock('../../local-db/local-charts', () => ({
  upsertLocalCharts: (charts: unknown[], options: {pruneMissing: boolean}) =>
    mockUpsertLocalCharts(charts, options),
}));
jest.mock('../../analytics/track', () => ({track: jest.fn()}));

import {
  scanSongsDirectory,
  tryGetSongsDirectoryHandle,
} from '@/lib/local-songs-folder';

const scanWithPickerFallback = () =>
  scanSongsDirectory(tryGetSongsDirectoryHandle);

describe('partial local chart scan persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: jest.fn(async () => mockSongsDirectory),
    });
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('upserts discoveries without pruning or replacing the complete cache', async () => {
    const chart = {artist: 'Artist', song: 'Song', charter: 'Charter'};
    const issue = {
      kind: 'directory',
      path: 'Songs/Inaccessible',
      message: 'Could not list chart directory Songs/Inaccessible',
    };
    localStorage.setItem('lastScannedInstalledCharts', 'existing-scan');
    mockScanLocalCharts.mockImplementation(
      async (_handle: unknown, accumulator: unknown[]) => {
        accumulator.push(chart);
        return {issues: [issue]};
      },
    );

    const result = await scanWithPickerFallback();

    expect(result).toMatchObject({
      status: 'partial',
      installedCharts: [chart],
      issues: [issue],
    });
    expect(mockUpsertLocalCharts).toHaveBeenCalledWith([chart], {
      pruneMissing: false,
    });
    expect(localStorage.getItem('lastScannedInstalledCharts')).toBe(
      'existing-scan',
    );
  });

  it('publishes a complete scan only after its charts are saved', async () => {
    let finishUpsert!: () => void;
    mockUpsertLocalCharts.mockReturnValue(
      new Promise<void>(resolve => {
        finishUpsert = resolve;
      }),
    );
    localStorage.setItem('lastScannedInstalledCharts', 'existing-scan');
    mockScanLocalCharts.mockResolvedValue({issues: []});

    let settled = false;
    const scanPromise = scanWithPickerFallback().then(result => {
      settled = true;
      return result;
    });

    await waitFor(() => expect(mockUpsertLocalCharts).toHaveBeenCalled());
    expect(settled).toBe(false);
    expect(localStorage.getItem('lastScannedInstalledCharts')).toBe(
      'existing-scan',
    );

    finishUpsert();
    const result = await scanPromise;

    expect(result?.status).toBe('complete');
    expect(mockUpsertLocalCharts).toHaveBeenCalledWith([], {
      pruneMissing: true,
    });
    expect(localStorage.getItem('lastScannedInstalledCharts')).not.toBe(
      'existing-scan',
    );
  });
});
