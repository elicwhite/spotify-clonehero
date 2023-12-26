import {levenshteinEditDistance} from 'levenshtein-edit-distance';
import {parse} from '@/lib/ini-parser';

export type SongIniData = {
  name: string;
  artist: string;
  charter: string;
  diff_drums: number;
  diff_drums_real?: number;
  diff_guitar: number;
};

export type SongAccumulator = {
  artist: string;
  song: string;
  lastModified: number;
  charter: string;
  data: SongIniData;
  fileHandle: FileSystemHandle;
  // handleInfo: {
  //   parentDir: FileSystemDirectoryHandle;
  //   fileName: string;
  // };
};

export default async function scanLocalCharts(
  directoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
) {
  let newestDate = 0;
  let songIniData: SongIniData | null = null;
  for await (const subHandle of directoryHandle.values()) {
    if (subHandle.kind == 'directory') {
      await scanLocalCharts(subHandle, accumulator, callbackPerSong);
    }

    if (subHandle.kind == 'file') {
      const file = await subHandle.getFile();

      if (subHandle.name == 'song.ini') {
        const text = await file.text();
        const values = parse(text);
        // @ts-ignore Assuming JSON matches TypeScript
        songIniData = values.iniObject?.song || values.iniObject?.Song;
      }

      if (file.lastModified > newestDate) {
        newestDate = file.lastModified;
      }
    }
  }

  if (songIniData != null) {
    const convertedSongIniData = convertValues(songIniData);
    accumulator.push({
      artist: songIniData?.artist,
      song: songIniData?.name,
      lastModified: newestDate,
      charter: songIniData?.charter,
      data: convertedSongIniData,
      fileHandle: directoryHandle,
    });
    callbackPerSong();
  }
}

function convertValues(songIniData: SongIniData) {
  const mappedEntries = Object.entries(songIniData).map(([key, value]) => {
    // @ts-ignore Checking if type is int
    const tryIntValue = parseInt(value, 10);
    if (value == tryIntValue || value == tryIntValue.toString()) {
      return [key, tryIntValue];
    }

    if (value == 'True') {
      return [key, true];
    } else if (value == 'False') {
      return [key, false];
    }

    return [key, value];
  });

  return Object.fromEntries(mappedEntries);
}

export async function createIsInstalledFilter(
  installedSongs: SongAccumulator[],
) {
  const installedArtistsSongs = new Map<string, string[]>();

  for (const installedSong of installedSongs) {
    const {artist, song} = installedSong;

    if (installedArtistsSongs.get(artist) == null) {
      installedArtistsSongs.set(artist, []);
    }

    installedArtistsSongs.get(artist)!.push(song);
  }

  return function isInstalled(artist: string, song: string) {
    let likelyArtists = [];

    for (const installedArtist of installedArtistsSongs.keys()) {
      const artistDistance = levenshteinEditDistance(installedArtist, artist);
      if (artistDistance <= 2) {
        likelyArtists.push(installedArtist);
      }
    }

    if (likelyArtists.length == 0) {
      return false;
    }

    const artistSongs = likelyArtists
      .map(artist => installedArtistsSongs.get(artist)!)
      .flat();

    if (artistSongs.length == 0) {
      return false;
    }

    let likelySong;

    for (const installedSong of artistSongs) {
      const songDistance = levenshteinEditDistance(installedSong, song);
      if (songDistance <= 4) {
        likelySong = installedSong;
      }
    }

    if (likelySong != null) {
      return true;
    }

    // Some installed songs have (2x double bass) suffixes.
    return artistSongs.some(artistSong => artistSong.includes(song));
  };
}
