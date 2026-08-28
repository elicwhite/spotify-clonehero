/**
 * Chrome's File System Access API refuses a file named exactly `song.ini`, so
 * on Windows a chart folder scans as no chart at all. These tests cover the
 * two halves of the recovery: the scan records such a folder, and one
 * `webkitdirectory` selection reads the metadata back.
 */
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => async (work: () => Promise<unknown>) => work(),
}));
jest.mock('@eliwhite/parse-sng', () => ({
  readSongIni: jest.fn(),
}));

import scanLocalCharts, {
  type BlockedChartFolder,
  type SongAccumulator,
} from '../scanLocalCharts';
import {rescueSongInis} from '../songIniRescue';

function entries(
  values: Array<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>,
) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* values;
    },
  };
}

function dir(
  name: string,
  children: Array<FileSystemDirectoryHandle | FileSystemFileHandle>,
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    entries: jest.fn(() => entries(children.map(child => [child.name, child]))),
  } as unknown as FileSystemDirectoryHandle;
}

/** A file the browser lists but refuses to open, as a blocked one behaves. */
function unreadableFile(name: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: jest.fn(async () => {
      throw new DOMException('The request is not allowed', 'NotAllowedError');
    }),
  } as unknown as FileSystemFileHandle;
}

function file(name: string): FileSystemFileHandle {
  return {kind: 'file', name} as unknown as FileSystemFileHandle;
}

/** A file the browser opens, as every file does off Windows. */
function readableFile(name: string, contents: string): FileSystemFileHandle {
  const bytes = new TextEncoder().encode(contents);
  return {
    kind: 'file',
    name,
    getFile: jest.fn(async () => ({
      arrayBuffer: async () => bytes.buffer,
      lastModified: 1,
    })),
  } as unknown as FileSystemFileHandle;
}

const SONG_INI = `[Song]
name = Blocked Song
artist = Blocked Band
charter = Someone
`;

/** A `song.ini` as an `<input type="file" webkitdirectory>` hands it back. */
function selectedSongIni(relativePath: string, contents = SONG_INI): File {
  const bytes = new TextEncoder().encode(contents);
  return {
    name: relativePath.split('/').at(-1),
    webkitRelativePath: relativePath,
    lastModified: 1_700_000_000_000,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as File;
}

describe('scanLocalCharts records the folders a rescue can read', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('records a chart folder whose song.ini is not in the listing', async () => {
    const chart = dir('Artist - Song (Charter)', [
      file('notes.chart'),
      file('song.ogg'),
    ]);
    const accumulator: SongAccumulator[] = [];

    const {issues, needSongIniRescue} = await scanLocalCharts(
      dir('Songs', [chart]),
      accumulator,
      jest.fn(),
    );

    expect(accumulator).toHaveLength(0);
    // Nothing failed, as far as the browser said. That is what makes the
    // folder invisible instead of reported.
    expect(issues).toEqual([]);
    expect(needSongIniRescue).toEqual([
      {
        path: 'Songs/Artist - Song (Charter)',
        handleInfo: {parentDir: expect.anything(), fileName: chart.name},
      },
    ]);
  });

  it('records a chart folder whose song.ini cannot be opened', async () => {
    const chart = dir('Artist - Song (Charter)', [
      file('notes.mid'),
      unreadableFile('song.ini'),
    ]);

    const {needSongIniRescue} = await scanLocalCharts(
      dir('Songs', [chart]),
      [],
      jest.fn(),
    );

    expect(needSongIniRescue.map(folder => folder.path)).toEqual([
      'Songs/Artist - Song (Charter)',
    ]);
  });

  it('records the picked folder when it is itself a blocked chart', async () => {
    const picked = dir('Artist - Song (Charter)', [file('notes.chart')]);

    const {needSongIniRescue} = await scanLocalCharts(picked, [], jest.fn());

    expect(needSongIniRescue).toEqual([
      {
        path: 'Artist - Song (Charter)',
        handleInfo: {dirHandle: picked, fileName: picked.name},
      },
    ]);
  });

  // A file the browser did open is nothing a second reader can improve on.
  it('records nothing for a song.ini that was read and holds no song', async () => {
    const chart = dir('Artist - Song (Charter)', [
      file('notes.chart'),
      readableFile('song.ini', '[Charter]\nname = Someone\n'),
    ]);

    const {needSongIniRescue} = await scanLocalCharts(
      dir('Songs', [chart]),
      [],
      jest.fn(),
    );

    expect(needSongIniRescue).toEqual([]);
  });

  it('records nothing for a folder that holds no chart file', async () => {
    const folder = dir('Album art', [file('cover.png')]);

    const {needSongIniRescue} = await scanLocalCharts(
      dir('Songs', [folder]),
      [],
      jest.fn(),
    );

    expect(needSongIniRescue).toEqual([]);
  });
});

describe('rescueSongInis', () => {
  const handleInfo = {
    parentDir: {} as FileSystemDirectoryHandle,
    fileName: 'Artist - Song (Charter)',
  };
  const candidate: BlockedChartFolder = {
    path: 'Songs/Artist - Song (Charter)',
    handleInfo,
  };

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('reads the metadata of a folder matched by its path', async () => {
    const {charts, missed} = await rescueSongInis(
      [candidate],
      [
        selectedSongIni('Songs/Artist - Song (Charter)/song.ini'),
        selectedSongIni('Songs/Artist - Song (Charter)/notes.chart', ''),
      ],
    );

    expect(missed).toBe(0);
    expect(charts).toHaveLength(1);
    expect(charts[0]).toMatchObject({
      song: 'Blocked Song',
      artist: 'Blocked Band',
      charter: 'Someone',
      handleInfo,
    });
    expect(charts[0].modifiedTime).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
  });

  it('matches a nested folder by the path below the picked folder', async () => {
    const nested: BlockedChartFolder = {
      path: 'Songs/Rock/Artist - Song (Charter)',
      handleInfo,
    };

    const {charts} = await rescueSongInis(
      [nested],
      [selectedSongIni('Clone Hero/Rock/Artist - Song (Charter)/song.ini')],
    );

    expect(charts).toHaveLength(1);
  });

  it('matches by folder name when the user picks another folder', async () => {
    const {charts, missed} = await rescueSongInis(
      [candidate],
      [selectedSongIni('Clone Hero/Songs/Artist - Song (Charter)/song.ini')],
    );

    expect(charts).toHaveLength(1);
    expect(missed).toBe(0);
  });

  it('ignores a song.ini no recorded folder asked for', async () => {
    const {charts, missed} = await rescueSongInis(
      [candidate],
      [selectedSongIni('Songs/Another Band - Another Song/song.ini')],
    );

    expect(charts).toEqual([]);
    expect(missed).toBe(1);
  });

  it('counts a folder whose song.ini names no song as unread', async () => {
    const {charts, missed} = await rescueSongInis(
      [candidate],
      [
        selectedSongIni(
          'Songs/Artist - Song (Charter)/song.ini',
          '[Song]\ndelay = 0\n',
        ),
      ],
    );

    expect(charts).toEqual([]);
    expect(missed).toBe(1);
  });
});
