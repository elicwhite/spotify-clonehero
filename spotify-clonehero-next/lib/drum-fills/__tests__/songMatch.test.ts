import {matchSong, type EnumeratedSong} from '../practice/songMatch';

function song(
  parentDir: string,
  fileName: string,
  meta: {song: string; artist: string; charter: string},
): EnumeratedSong {
  return {
    ...meta,
    handleInfo: {parentDir: {name: parentDir}, fileName},
  };
}

const songs: EnumeratedSong[] = [
  song('Rock', 'Song A', {song: 'A', artist: 'X', charter: 'C1'}),
  song('Rock', 'Song B', {song: 'B', artist: 'Y', charter: 'C2'}),
  song('Metal', 'tune.sng', {song: 'B', artist: 'Y', charter: 'C3'}),
];

describe('matchSong', () => {
  it('prefers an exact libraryPath match', () => {
    const match = matchSong(songs, {
      libraryPath: 'Rock/Song A',
      song: 'A',
      artist: 'X',
      charter: 'C1',
    });
    expect(match).toBe(songs[0]);
  });

  it('falls back to song+artist+charter when the path drifted', () => {
    const match = matchSong(songs, {
      libraryPath: 'OldFolder/Song B',
      song: 'B',
      artist: 'Y',
      charter: 'C2',
    });
    expect(match).toBe(songs[1]);
  });

  it('disambiguates by charter when song+artist collide', () => {
    const match = matchSong(songs, {
      libraryPath: 'gone',
      song: 'B',
      artist: 'Y',
      charter: 'C3',
    });
    expect(match).toBe(songs[2]);
  });

  it('falls back to song+artist when charter does not match', () => {
    const match = matchSong(songs, {
      libraryPath: 'gone',
      song: 'B',
      artist: 'Y',
      charter: 'UnknownCharter',
    });
    // First song+artist hit wins.
    expect(match).toBe(songs[1]);
  });

  it('returns null when nothing matches', () => {
    const match = matchSong(songs, {
      libraryPath: 'nope',
      song: 'Z',
      artist: 'Q',
      charter: 'C9',
    });
    expect(match).toBeNull();
  });
});
