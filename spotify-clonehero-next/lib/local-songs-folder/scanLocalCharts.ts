import {levenshteinEditDistance} from 'levenshtein-edit-distance';
import pLimit, {type LimitFunction} from 'p-limit';
import {parse} from '@/lib/ini-parser';
import * as Sentry from '@sentry/nextjs';
import {SngStream} from 'parse-sng';
import {removeStyleTags} from '@/lib/ui-utils';

// Caps concurrent FS ops across the whole recursive scan. Without a shared
// limit, Promise.all at every level would multiply with depth and exhaust
// file handles on large libraries.
const SCAN_CONCURRENCY = 32;

type EntryHandle = FileSystemDirectoryHandle | FileSystemFileHandle;

async function listEntries(
  dir: FileSystemDirectoryHandle,
): Promise<Array<[string, EntryHandle]>> {
  const iter = await dir.entries();
  // @ts-ignore fromAsync is not defined in TS yet
  return (await Array.fromAsync(iter)) as Array<[string, EntryHandle]>;
}

export type SongIniData = {
  name: string;
  artist: string;
  charter: string;
  genre?: string | null;
  diff_drums?: number | null;
  diff_drums_real?: number | null;
  diff_guitar?: number | null;
  song_length?: number | null;
  frets?: string | null;
};

export type SongAccumulator = {
  artist: string;
  song: string; // Change this to Name to match Encore
  modifiedTime: string;
  charter: string;
  genre: string;
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

  const limit = pLimit(SCAN_CONCURRENCY);
  const entries = await listEntries(directoryHandle);

  await Promise.all(
    entries.map(([, subHandle]) => {
      if (subHandle.kind === 'directory') {
        return scanLocalChartsDirectory(
          directoryHandle,
          subHandle,
          accumulator,
          callbackPerSong,
          limit,
        );
      }
      if (
        subHandle.kind === 'file' &&
        subHandle.name.toLowerCase().endsWith('.sng')
      ) {
        return scanLocalSngFile(
          directoryHandle,
          subHandle,
          accumulator,
          callbackPerSong,
          limit,
        );
      }
      return undefined;
    }),
  );
}

async function scanLocalChartsDirectory(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  currentDirectoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
  limit: LimitFunction,
) {
  let newestDate = 0;
  let songIniData: SongIniData | null = null;

  let entries: Array<[string, EntryHandle]>;
  try {
    entries = await listEntries(currentDirectoryHandle);
  } catch (e) {
    const error = new Error(
      `Error scanning directory ${parentDirectoryHandle.name}/${currentDirectoryHandle.name}`,
      {cause: e},
    );
    Sentry.captureException(error);
    console.error(error.message);
    return;
  }

  await Promise.all(
    entries.map(async ([, subHandle]) => {
      if (subHandle.kind === 'directory') {
        await scanLocalChartsDirectory(
          currentDirectoryHandle,
          subHandle,
          accumulator,
          callbackPerSong,
          limit,
        );
        return;
      }
      if (subHandle.kind !== 'file') return;

      if (subHandle.name.toLowerCase().endsWith('.sng')) {
        await scanLocalSngFile(
          currentDirectoryHandle,
          subHandle,
          accumulator,
          callbackPerSong,
          limit,
        );
        return;
      }

      await limit(async () => {
        let file: File;
        try {
          file = await subHandle.getFile();
        } catch {
          return;
        }
        if (subHandle.name === 'song.ini') {
          try {
            const text = await file.text();
            const values = parse(text);
            // @ts-ignore Assuming JSON matches TypeScript
            songIniData = values.iniObject?.song || values.iniObject?.Song;
          } catch (e) {
            console.log(
              'Could not scan song.ini of',
              currentDirectoryHandle.name,
            );
            return;
          }
        }
        // Read-modify-write happens synchronously within this callback, so
        // the parallel callbacks can't race on newestDate.
        if (file.lastModified > newestDate) {
          newestDate = file.lastModified;
        }
      });
    }),
  );

  // Cast back to the declared union — control-flow analysis collapses the
  // variable to its initializer's `null` type because all assignments happen
  // inside Promise.all callbacks, which CFA treats as opaque.
  const finalIni = songIniData as SongIniData | null;
  if (finalIni != null) {
    const convertedSongIniData = convertValues(finalIni);
    const chart = {
      artist: removeStyleTags(finalIni.artist),
      song: removeStyleTags(finalIni.name),
      modifiedTime: new Date(newestDate).toISOString(),
      charter: removeStyleTags(finalIni.charter || finalIni.frets || ''),
      genre: removeStyleTags(finalIni.genre ?? ''),
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

async function scanLocalSngFile(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  fileHandle: FileSystemFileHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
  limit: LimitFunction,
) {
  await limit(() =>
    scanLocalSngFileInner(
      parentDirectoryHandle,
      fileHandle,
      accumulator,
      callbackPerSong,
    ),
  );
}

async function scanLocalSngFileInner(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  fileHandle: FileSystemFileHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
) {
  const file = await fileHandle.getFile();
  let songIniData: SongIniData | null;

  try {
    songIniData = await new Promise<SongIniData | null>((resolve, reject) => {
      let localSongIniData: SongIniData | null = null;
      const sngStream = new SngStream(file.stream(), {generateSongIni: true});
      sngStream.on('file', async (fileName, fileStream, nextFile) => {
        try {
          if (fileName === 'song.ini') {
            const text = await new Response(fileStream).text();
            const values = parse(text);
            // @ts-ignore Assuming JSON matches TypeScript
            localSongIniData = values.iniObject?.song || values.iniObject?.Song;
          } else {
            const reader = fileStream.getReader();
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const result = await reader.read();
              if (result.done) {
                break;
              }
            }
          }
        } catch (e) {
          console.log('Could not scan song.ini of', fileHandle.name);
        }

        if (nextFile) {
          nextFile();
        } else {
          resolve(localSongIniData);
        }
      });
      sngStream.on('error', err => reject(err));
      sngStream.start();
    });
  } catch (e) {
    const error = new Error(
      `Error scanning sng file ${parentDirectoryHandle.name}/${fileHandle.name}`,
      {cause: e},
    );
    Sentry.captureException(error);
    console.error(error.message);
    return;
  }

  if (songIniData != null) {
    const convertedSongIniData = convertValues(songIniData);
    const chart = {
      artist: removeStyleTags(songIniData.artist),
      song: removeStyleTags(songIniData.name),
      modifiedTime: new Date(file.lastModified).toISOString(),
      charter: removeStyleTags(songIniData.charter || songIniData.frets || ''),
      genre: removeStyleTags(songIniData.genre ?? ''),
      data: convertedSongIniData,
      handleInfo: {
        parentDir: parentDirectoryHandle,
        fileName: fileHandle.name,
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

function convertValues(songIniData: SongIniData): SongIniData {
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

export type SongInstalledChecker = (artist: string, song: string) => boolean;

function createChartLookupKey(artist: string, song: string, charter: string) {
  return `${artist} - ${song} - ${charter}`;
}

function createSongLookupKey(artist: string, song: string) {
  return `${artist} - ${song}`;
}

export function createIsInstalledFilter(
  installedSongs: SongAccumulator[],
): {isChartInstalled: ChartInstalledChecker; isSongInstalled: SongInstalledChecker} {
  const installedCharts = new Set<string>();
  const installedSongKeys = new Set<string>();

  for (const installedSong of installedSongs) {
    const {artist, song, charter} = installedSong;
    installedCharts.add(createChartLookupKey(artist, song, charter));
    installedSongKeys.add(createSongLookupKey(artist, song));
  }

  return {
    isChartInstalled(artist: string, song: string, charter: string) {
      return installedCharts.has(createChartLookupKey(artist, song, charter));
    },
    isSongInstalled(artist: string, song: string) {
      return installedSongKeys.has(createSongLookupKey(artist, song));
    },
  };
}
