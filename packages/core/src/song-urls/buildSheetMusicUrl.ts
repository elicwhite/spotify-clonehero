import {buildSongSlug} from './songSlug';

export function getSheetMusicUrl(
  artist: string,
  song: string,
  hash: string,
): string {
  return `/sheet-music/${buildSongSlug(song, artist, hash)}`;
}
