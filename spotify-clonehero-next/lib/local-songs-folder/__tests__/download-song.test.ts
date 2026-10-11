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
  const removeBackup = jest.fn().mockResolvedValueOnce(undefined);
  if (options?.cleanupError) {
    removeBackup.mockRejectedValueOnce(options.cleanupError);
  } else {
    removeBackup.mockResolvedValueOnce(undefined);
  }
  const backupDirectory = {
    removeEntry: removeBackup,
    getFileHandle: jest.fn(async () => backupFile),
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
    backupDirectory,
    backupWritable,
    copyPipeTo,
    destinationDirectory,
    destinationWritable,
    responsePipeTo,
  };
}

const successfulDownloadOptions = {
  asSng: true,
  source: 'find_music' as const,
  md5: 'chart-md5',
};

function intoFolder(folder: unknown) {
  return {kind: 'folder', folder: folder as FileSystemDirectoryHandle} as const;
}

describe('downloadSong outcomes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdbGet.mockResolvedValue(undefined);
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      value: mockFetch,
    });
  });

  it('saves a browser download without writing to OPFS', async () => {
    const getDirectory = jest.fn();
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {getDirectory},
    });
    mockFetch.mockResolvedValue({ok: true, status: 200, body: {}});
    // jsdom has no Response; the body only has to become a Blob.
    Object.defineProperty(global, 'Response', {
      configurable: true,
      value: class {
        async blob() {
          return new Blob(['sng bytes']);
        }
      },
    });
    const createObjectURL = jest.fn(() => 'blob:chart');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
        {kind: 'browser-download'},
        successfulDownloadOptions,
      ),
    ).resolves.toEqual({status: 'downloaded', fileName: filename});

    expect(getDirectory).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith({
      event: 'chart_downloaded',
      source: 'find_music',
      format: 'sng',
      destination: 'browser-download',
      md5: 'chart-md5',
    });
  });

  it('rejects an unsuccessful HTTP response', async () => {
    mockFetch.mockResolvedValue({ok: false, status: 503, body: {}});

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
        intoFolder({}),
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
        intoFolder({}),
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
        intoFolder(destinationDirectory),
        successfulDownloadOptions,
      ),
    ).resolves.toEqual({
      status: 'installed',
      newParentDirectoryHandle: destinationDirectory,
      fileName: filename,
    });

    expect(responsePipeTo).toHaveBeenCalledWith(backupWritable);
    expect(copyPipeTo).toHaveBeenCalledWith(destinationWritable);
    expect(mockTrack).toHaveBeenCalledWith({
      event: 'chart_downloaded',
      source: 'find_music',
      format: 'sng',
      destination: 'folder',
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
        intoFolder(destinationDirectory),
        successfulDownloadOptions,
      ),
    ).resolves.toEqual({
      status: 'installed',
      newParentDirectoryHandle: destinationDirectory,
      fileName: filename,
    });

    expect(warn).toHaveBeenCalledWith(
      `Could not remove download backup ${filename}`,
      cleanupError,
    );
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });

  it('downloads over a chart that is already installed', async () => {
    // Nothing staged is the usual state, and the browser says so by refusing
    // to remove the name. The chart in the destination is replaced, not
    // refused: the user asked for this download.
    const {backupDirectory, destinationDirectory} = setupSuccessfulDownload();
    backupDirectory.removeEntry.mockReset();
    backupDirectory.removeEntry.mockRejectedValueOnce(
      new DOMException('A requested file could not be found', 'NotFoundError'),
    );
    backupDirectory.removeEntry.mockResolvedValue(undefined);

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
        intoFolder(destinationDirectory),
        successfulDownloadOptions,
      ),
    ).resolves.toEqual({
      status: 'installed',
      newParentDirectoryHandle: destinationDirectory,
      fileName: filename,
    });
  });

  it('reports why a staged download could not be cleared', async () => {
    // The reason itself, rather than a guess at what it means. An unremovable
    // staging copy is the one state that must stop a download, because two
    // attempts writing one staged file corrupt both.
    const {backupDirectory, destinationDirectory} = setupSuccessfulDownload();
    backupDirectory.removeEntry.mockReset();
    backupDirectory.removeEntry.mockRejectedValue(
      new DOMException('The file is locked', 'NoModificationAllowedError'),
    );

    await expect(
      downloadSong(
        'Artist',
        'Song',
        'Charter',
        'https://example.com/chart.sng',
        intoFolder(destinationDirectory),
        successfulDownloadOptions,
      ),
    ).rejects.toThrow('The file is locked');

    expect(mockTrack).not.toHaveBeenCalled();
  });
});
