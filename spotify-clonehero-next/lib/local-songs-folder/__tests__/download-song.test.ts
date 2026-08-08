/** @jest-environment jsdom */

const filename = 'Artist - Song (Charter).sng';
const mockIdbGet = jest.fn();
const mockFetch = jest.fn();
const mockTrack = jest.fn();

jest.mock('idb-keyval', () => ({
  get: (...args: unknown[]) => mockIdbGet(...args),
  set: jest.fn(async () => undefined),
}));
jest.mock('filenamify/browser', () => jest.fn(() => filename));
jest.mock('../scanLocalCharts', () => jest.fn());
jest.mock('../../local-db/local-charts', () => ({
  upsertLocalCharts: jest.fn(),
}));
jest.mock('../../analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

import {downloadSong} from '@/lib/local-songs-folder';

function setupSuccessfulDownload(options?: {cleanupError?: Error}) {
  const responsePipeTo = jest.fn(async () => undefined);
  const copyPipeTo = jest.fn(async () => undefined);
  const backupWritable = {} as FileSystemWritableFileStream;
  const destinationWritable = {} as FileSystemWritableFileStream;
  const backupFile = {
    kind: 'file',
    name: filename,
    createWritable: jest.fn(async () => backupWritable),
    getFile: jest.fn(async () => ({
      stream: () => ({pipeTo: copyPipeTo}),
    })),
  };
  let backupLookupCount = 0;
  const removeBackup = jest.fn().mockResolvedValueOnce(undefined);
  if (options?.cleanupError) {
    removeBackup.mockRejectedValueOnce(options.cleanupError);
  } else {
    removeBackup.mockResolvedValueOnce(undefined);
  }
  const backupDirectory = {
    removeEntry: removeBackup,
    getFileHandle: jest.fn(
      async (_name: string, handleOptions: {create: boolean}) => {
        if (handleOptions.create) return backupFile;
        backupLookupCount += 1;
        if (backupLookupCount === 1) throw new Error('Not found');
        return backupFile;
      },
    ),
    getDirectoryHandle: jest.fn(async () => {
      throw new Error('Not a directory');
    }),
  };
  const destinationFile = {
    createWritable: jest.fn(async () => destinationWritable),
  };
  const destinationDirectory = {
    removeEntry: jest.fn(async () => undefined),
    getDirectoryHandle: jest.fn(async () => {
      throw new Error('Not found');
    }),
    getFileHandle: jest.fn(async () => destinationFile),
  };
  const storageRoot = {
    getDirectoryHandle: jest.fn(async () => backupDirectory),
  };
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {getDirectory: jest.fn(async () => storageRoot)},
  });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: {pipeTo: responsePipeTo},
  });

  return {
    backupWritable,
    copyPipeTo,
    destinationDirectory,
    destinationWritable,
    responsePipeTo,
  };
}

function successfulDownloadOptions(folder: FileSystemDirectoryHandle) {
  return {
    folder,
    asSng: true,
    source: 'spotify' as const,
    md5: 'chart-md5',
  };
}

describe('downloadSong outcomes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdbGet.mockResolvedValue(undefined);
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      value: mockFetch,
    });
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('returns cancellation before starting a request or emitting analytics', async () => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: jest.fn(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      }),
    });

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
      ),
    ).resolves.toEqual({status: 'canceled'});

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('rejects an unsuccessful HTTP response', async () => {
    mockFetch.mockResolvedValue({ok: false, status: 503, body: {}});

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
        {
          folder: {} as FileSystemDirectoryHandle,
        },
      ),
    ).rejects.toThrow('Chart download failed with HTTP 503');

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('rejects a successful response without a body', async () => {
    mockFetch.mockResolvedValue({ok: true, status: 200, body: null});

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
        {
          folder: {} as FileSystemDirectoryHandle,
        },
      ),
    ).rejects.toThrow('Chart download response did not include a body');

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('emits download analytics only after the chart is installed', async () => {
    const {
      backupWritable,
      copyPipeTo,
      destinationDirectory,
      destinationWritable,
      responsePipeTo,
    } = setupSuccessfulDownload();

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
        successfulDownloadOptions(
          destinationDirectory as unknown as FileSystemDirectoryHandle,
        ),
      ),
    ).resolves.toEqual({
      status: 'downloaded',
      newParentDirectoryHandle: destinationDirectory,
      fileName: filename,
    });

    expect(responsePipeTo).toHaveBeenCalledWith(backupWritable);
    expect(copyPipeTo).toHaveBeenCalledWith(destinationWritable);
    expect(mockTrack).toHaveBeenCalledWith({
      event: 'chart_downloaded',
      source: 'spotify',
      format: 'sng',
      md5: 'chart-md5',
    });
    expect(copyPipeTo.mock.invocationCallOrder[0]).toBeLessThan(
      mockTrack.mock.invocationCallOrder[0],
    );
  });

  it('keeps the downloaded result when backup cleanup fails', async () => {
    const cleanupError = new Error('OPFS cleanup failed');
    const {destinationDirectory} = setupSuccessfulDownload({cleanupError});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
        successfulDownloadOptions(
          destinationDirectory as unknown as FileSystemDirectoryHandle,
        ),
      ),
    ).resolves.toEqual({
      status: 'downloaded',
      newParentDirectoryHandle: destinationDirectory,
      fileName: filename,
    });

    expect(warn).toHaveBeenCalledWith(
      `Could not remove download backup ${filename}`,
      cleanupError,
    );
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });
});
