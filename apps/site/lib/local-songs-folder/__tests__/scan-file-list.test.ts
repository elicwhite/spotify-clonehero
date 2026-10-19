const mockReadSongIni = jest.fn();

jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => async (work: () => Promise<unknown>) => work(),
}));
jest.mock('@eliwhite/parse-sng', () => ({
  readSongIni: (stream: unknown) => mockReadSongIni(stream),
}));

import scanLocalCharts, {type SongAccumulator} from '../scanLocalCharts';
import {folderSourceFromFileList} from '../../file-access/folderSource';

/** What a `webkitdirectory` input hands back for one file. */
function selected(path: string, contents = '') {
  const bytes = new TextEncoder().encode(contents);
  return {
    name: path.split('/').pop(),
    webkitRelativePath: path,
    lastModified: Date.UTC(2026, 0, 2),
    arrayBuffer: jest.fn(async () => bytes.buffer),
    stream: jest.fn(() => `stream of ${path}`),
  } as unknown as File & {arrayBuffer: jest.Mock; stream: jest.Mock};
}

const songIni = (name: string, artist: string) =>
  `[song]\nname = ${name}\nartist = ${artist}\ncharter = Charter\n`;

describe('scanLocalCharts over a file input selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('finds charts at every depth and opens only their metadata', async () => {
    const audio = selected('Songs/Band - Song/song.ogg');
    const nestedIni = selected(
      'Songs/Pack/Other - Deep/song.ini',
      songIni('Deep', 'Other'),
    );
    const packed = selected('Songs/Packed.sng');
    mockReadSongIni.mockResolvedValue({name: 'Packed', artist: 'Sng Band'});

    const charts: SongAccumulator[] = [];
    const {issues} = await scanLocalCharts(
      folderSourceFromFileList([
        selected('Songs/Band - Song/song.ini', songIni('Song', 'Band')),
        audio,
        selected('Songs/Band - Song/notes.chart'),
        nestedIni,
        packed,
      ])!,
      charts,
      jest.fn(),
    );

    expect(issues).toEqual([]);
    expect(
      charts.map(({artist, song, location: {parent, entry}}) => ({
        artist,
        song,
        at: `${parent?.name}/${entry.name}`,
        writable: parent?.handle != null,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          artist: 'Band',
          song: 'Song',
          at: 'Songs/Band - Song',
          writable: false,
        },
        {
          artist: 'Other',
          song: 'Deep',
          at: 'Pack/Other - Deep',
          writable: false,
        },
        {
          artist: 'Sng Band',
          song: 'Packed',
          at: 'Songs/Packed.sng',
          writable: false,
        },
      ]),
    );
    expect(charts).toHaveLength(3);
    expect(mockReadSongIni).toHaveBeenCalledWith('stream of Songs/Packed.sng');
    // The library is never read past its metadata.
    expect(audio.arrayBuffer).not.toHaveBeenCalled();
    expect(audio.stream).not.toHaveBeenCalled();
  });

  it('finds no folder in a selection that the browser gave no folder for', () => {
    const loose = selected('song.ini');
    Object.defineProperty(loose, 'webkitRelativePath', {value: ''});

    expect(folderSourceFromFileList([loose])).toBeNull();
  });
});
