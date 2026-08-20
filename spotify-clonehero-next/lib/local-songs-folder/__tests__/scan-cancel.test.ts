/** @jest-environment jsdom */

jest.mock('idb-keyval', () => ({
  get: jest.fn(async () => undefined),
  set: jest.fn(async () => undefined),
}));
jest.mock('filenamify/browser', () => jest.fn());
jest.mock('../scanLocalCharts', () => jest.fn());
jest.mock('../../local-db/local-charts', () => ({
  upsertLocalCharts: jest.fn(),
}));

import {
  scanSongsDirectory,
  tryGetSongsDirectoryHandle,
} from '@/lib/local-songs-folder';

const scanWithPickerFallback = () =>
  scanSongsDirectory(tryGetSongsDirectoryHandle);

describe('local chart scan cancellation', () => {
  it('returns cancellation instead of throwing an error', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {getDirectory: jest.fn(async () => ({}))},
    });
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: jest.fn(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }),
    });
    jest.spyOn(window, 'alert').mockImplementation(() => {});

    await expect(scanWithPickerFallback()).resolves.toBeNull();
  });

  it('still rejects unexpected picker failures', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {getDirectory: jest.fn(async () => ({}))},
    });
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: jest.fn(async () => {
        throw new Error('picker implementation failed');
      }),
    });
    jest.spyOn(window, 'alert').mockImplementation(() => {});

    await expect(scanWithPickerFallback()).rejects.toThrow(
      'picker implementation failed',
    );
  });
});
