const mockParse = jest.fn();
const mockReadSongIni = jest.fn();

jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => async (work: () => Promise<unknown>) => work(),
}));
jest.mock('../../ini-parser', () => ({
  parse: (contents: string) => mockParse(contents),
}));
jest.mock('@eliwhite/parse-sng', () => ({
  readSongIni: (stream: ReadableStream) => mockReadSongIni(stream),
}));

import scanLocalCharts from '../scanLocalCharts';

function entries(
  values: Array<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>,
) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* values;
    },
  };
}

describe('scanLocalCharts issues', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reports an unreadable subtree instead of silently declaring success', async () => {
    const inaccessible = {
      kind: 'directory',
      name: 'Inaccessible',
      entries: jest.fn(() => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }),
    } as unknown as FileSystemDirectoryHandle;
    const songs = {
      kind: 'directory',
      name: 'Songs',
      entries: jest.fn(() => entries([['Inaccessible', inaccessible]])),
    } as unknown as FileSystemDirectoryHandle;
    const result = await scanLocalCharts(songs, [], jest.fn());

    expect(result).toEqual({
      issues: [
        {
          kind: 'directory',
          path: 'Songs/Inaccessible',
          message: 'Could not list chart directory Songs/Inaccessible',
        },
      ],
    });
  });

  it('reports malformed song.ini metadata', async () => {
    mockParse.mockImplementation(() => {
      throw new Error('invalid ini');
    });
    const songIni = {
      kind: 'file',
      name: 'song.ini',
      getFile: jest.fn(async () => ({
        text: jest.fn(async () => 'not valid ini'),
        lastModified: 1,
      })),
    } as unknown as FileSystemFileHandle;
    const chart = {
      kind: 'directory',
      name: 'Broken Chart',
      entries: jest.fn(() => entries([['song.ini', songIni]])),
    } as unknown as FileSystemDirectoryHandle;
    const songs = {
      kind: 'directory',
      name: 'Songs',
      entries: jest.fn(() => entries([['Broken Chart', chart]])),
    } as unknown as FileSystemDirectoryHandle;

    await expect(scanLocalCharts(songs, [], jest.fn())).resolves.toEqual({
      issues: [
        {
          kind: 'song-ini',
          path: 'Songs/Broken Chart/song.ini',
          message: 'Could not parse Songs/Broken Chart/song.ini',
        },
      ],
    });
  });

  it('reports unreadable SNG metadata', async () => {
    mockReadSongIni.mockRejectedValue(new Error('invalid sng'));
    const sng = {
      kind: 'file',
      name: 'Broken.sng',
      getFile: jest.fn(async () => ({
        stream: jest.fn(() => new ReadableStream()),
        lastModified: 1,
      })),
    } as unknown as FileSystemFileHandle;
    const songs = {
      kind: 'directory',
      name: 'Songs',
      entries: jest.fn(() => entries([['Broken.sng', sng]])),
    } as unknown as FileSystemDirectoryHandle;

    await expect(scanLocalCharts(songs, [], jest.fn())).resolves.toEqual({
      issues: [
        {
          kind: 'sng',
          path: 'Songs/Broken.sng',
          message: 'Could not read SNG metadata from Songs/Broken.sng',
        },
      ],
    });
  });

  it('still rejects when the selected root cannot be listed', async () => {
    const songs = {
      kind: 'directory',
      name: 'Songs',
      entries: jest.fn(() => {
        throw new Error('root disconnected');
      }),
    } as unknown as FileSystemDirectoryHandle;

    await expect(scanLocalCharts(songs, [], jest.fn())).rejects.toThrow(
      'root disconnected',
    );
  });
});
