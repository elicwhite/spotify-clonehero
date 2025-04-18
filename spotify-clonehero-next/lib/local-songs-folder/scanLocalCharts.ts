import {levenshteinEditDistance} from 'levenshtein-edit-distance';
import {parse} from '@/lib/ini-parser';
import * as Sentry from '@sentry/nextjs';

export type SongIniData = {
  name: string;
  artist: string;
  charter: string;
  diff_drums?: number | null;
  diff_drums_real?: number | null;
  diff_guitar?: number | null;
  song_length?: number | null;
};

export type SongAccumulator = {
  artist: string;
  song: string; // Change this to Name to match Encore
  modifiedTime: string;
  charter: string;
  data: SongIniData;
  file: string; // This will throw if you access it
  // fileHandle: FileSystemFileHandle | FileSystemDirectoryHandle;
  handleInfo: {
    parentDir: FileSystemDirectoryHandle;
    fileName: string;
  };
};

export default async function scanLocalCharts(
  directoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
) {
  // Every entry in this directory handle should be a song, or folder of songs

  const entries = await directoryHandle.entries();
  // @ts-ignore fromAsync is not defined in TS yet
  const arr = (await Array.fromAsync(entries)).toSorted((a, b) =>
    a[0].localeCompare(b[0]),
  );

  for (const [name, subHandle] of arr) {
    if (subHandle.kind == 'directory') {
      await scanLocalChartsDirectory(
        directoryHandle,
        subHandle,
        accumulator,
        callbackPerSong,
      );
    }
  }
}

async function scanLocalChartsDirectory(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  currentDirectoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
) {
  let newestDate = 0;
  let songIniData: SongIniData | null = null;
  try {
    const entries = await currentDirectoryHandle.entries();
    // @ts-ignore fromAsync is not defined in TS yet
    const arr = (await Array.fromAsync(entries)).toSorted((a, b) =>
      a[0].localeCompare(b[0]),
    );

    for (const [name, subHandle] of arr) {
      if (subHandle.kind == 'directory') {
        await scanLocalChartsDirectory(
          currentDirectoryHandle,
          subHandle,
          accumulator,
          callbackPerSong,
        );
      }

      if (subHandle.kind == 'file') {
        const file = await subHandle.getFile();
        try {
          if (subHandle.name == 'song.ini') {
            const text = await file.text();
            const values = parse(text);
            // @ts-ignore Assuming JSON matches TypeScript
            songIniData = values.iniObject?.song || values.iniObject?.Song;
          }
        } catch (e) {
          console.log(
            'Could not scan song.ini of',
            currentDirectoryHandle.name,
          );
          continue;
        }

        if (file.lastModified > newestDate) {
          newestDate = file.lastModified;
        }
      }
    }
  } catch (e) {
    const error = new Error(
      `Error scanning directory ${parentDirectoryHandle.name}/${currentDirectoryHandle.name}`,
      {
        cause: e,
      },
    );
    Sentry.captureException(error);
    console.error(error.message);
    return;
  }

  if (songIniData != null) {
    const convertedSongIniData = convertValues(songIniData);
    const chart = {
      artist: songIniData?.artist,
      song: songIniData?.name,
      modifiedTime: new Date(newestDate).toISOString(),
      charter: songIniData?.charter,
      data: convertedSongIniData,
      handleInfo: {
        parentDir: parentDirectoryHandle,
        fileName: currentDirectoryHandle.name,
      },
      file: '',
    };
    Object.defineProperty(chart, 'file', {
      get() {
        throw new Error('Charts from disk do not have a download URL');
      },
      enumerable: false, // Can't serialize to JSON
    });

    accumulator.push(chart);
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

export type ChartInstalledChecker = (
  artist: string,
  song: string,
  charter: string,
) => boolean;

function createLookupKey(artist: string, song: string, charter: string) {
  return `${artist} - ${song} - ${charter}`;
}
export function createIsInstalledFilter(
  installedSongs: SongAccumulator[],
): ChartInstalledChecker {
  const installedCharts = new Set<string>();

  for (const installedSong of installedSongs) {
    const {artist, song, charter} = installedSong;
    installedCharts.add(createLookupKey(artist, song, charter));
  }

  return function isChartInstalled(
    artist: string,
    song: string,
    charter: string,
  ) {
    return installedCharts.has(createLookupKey(artist, song, charter));
  };
}
