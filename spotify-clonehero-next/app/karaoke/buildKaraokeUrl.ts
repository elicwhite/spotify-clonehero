import {buildSongSlug} from '@/app/songSlug';

export function getKaraokeUrl(
  artist: string,
  song: string,
  hash: string,
): string {
  return `/karaoke/${buildSongSlug(song, artist, hash)}`;
}
