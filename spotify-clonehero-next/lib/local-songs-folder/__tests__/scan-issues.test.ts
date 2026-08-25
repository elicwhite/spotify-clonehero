const mockParse = jest.fn();
const mockReadSongIni = jest.fn();

jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => async (work: () => Promise<unknown>) => work(),
}));
jest.mock('../../ini-parser', () => ({
  parse: (contents: Uint8Array) => mockParse(contents),
}));
jest.mock('@eliwhite/parse-sng', () => ({
  readSongIni: (stream: ReadableStream) => mockReadSongIni(stream),
}));

import scanLocalCharts, {type SongAccumulator} from '../scanLocalCharts';

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
        arrayBuffer: jest.fn(
          async () => new TextEncoder().encode('not valid ini').buffer,
        ),
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

  // A user may pick one chart's own folder rather than a folder of charts.
  // That folder has no parent handle, so the chart carries its own.
  it('scans the picked folder when it is itself a chart', async () => {
    mockParse.mockReturnValue({
      iniObject: {song: {name: 'Root Song', artist: 'Root Band'}},
      iniErrors: [],
    });
    const songIni = {
      kind: 'file',
      name: 'song.ini',
      getFile: jest.fn(async () => ({
        arrayBuffer: jest.fn(async () => new ArrayBuffer(0)),
        lastModified: 1,
      })),
    } as unknown as FileSystemFileHandle;
    const picked = {
      kind: 'directory',
      name: 'Artist - Song (Charter)',
      entries: jest.fn(() => entries([['song.ini', songIni]])),
    } as unknown as FileSystemDirectoryHandle;

    const accumulator: SongAccumulator[] = [];
    await expect(
      scanLocalCharts(picked, accumulator, jest.fn()),
    ).resolves.toEqual({issues: []});
    expect(accumulator).toHaveLength(1);
    expect(accumulator[0].song).toBe('Root Song');
    expect(accumulator[0].handleInfo).toEqual({
      dirHandle: picked,
      fileName: 'Artist - Song (Charter)',
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
