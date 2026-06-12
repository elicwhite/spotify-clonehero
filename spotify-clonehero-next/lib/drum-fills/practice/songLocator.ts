/**
 * Filesystem wrapper around {@link matchSong}: enumerate the user's library and
 * read all of a matched song's files for practice playback.
 *
 * Uses the shared library walker (`scanLocalCharts`) + chart readers
 * (`chart-file-readers`). The pure matching logic lives in ./songMatch.ts.
 */

import scanLocalCharts, {
  type SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {
  readChartDirectory,
  readSngFile,
} from '@/components/chart-picker/chart-file-readers';
import type {Files} from '@/lib/preview/chorus-chart-processing';
import {matchSong, type SongRef} from './songMatch';

/** Read every file for an enumerated song (folder or .sng). */
export async function readAllSongFiles(song: SongAccumulator): Promise<Files> {
  const {parentDir, fileName} = song.handleInfo;
  if (fileName.toLowerCase().endsWith('.sng')) {
    const fileHandle = await parentDir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const loaded = await readSngFile(file);
    return loaded.files;
  }
  const dirHandle = await parentDir.getDirectoryHandle(fileName);
  const loaded = await readChartDirectory(dirHandle);
  return loaded.files;
}

/**
 * Enumerate the library under `directoryHandle`, match the fill's song, and read
 * all of its files. Returns null when the song can't be found.
 */
export async function locateAndLoadSong(
  directoryHandle: FileSystemDirectoryHandle,
  ref: SongRef,
): Promise<{song: SongAccumulator; files: Files} | null> {
  const songs: SongAccumulator[] = [];
  await scanLocalCharts(directoryHandle, songs, () => {});
  const match = matchSong(songs, ref);
  if (!match) return null;
  const files = await readAllSongFiles(match);
  return {song: match, files};
}
