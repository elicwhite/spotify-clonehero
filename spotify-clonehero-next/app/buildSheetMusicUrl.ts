import {buildSongSlug} from '@/app/songSlug';

export function getSheetMusicUrl(
  artist: string,
  song: string,
  hash: string,
): string {
  return `/sheet-music/${buildSongSlug(song, artist, hash)}`;
}
