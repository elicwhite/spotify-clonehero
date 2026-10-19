import {buildSongSlug} from '@/lib/song-urls/songSlug';

export function getKaraokeUrl(
  artist: string,
  song: string,
  hash: string,
): string {
  return `/karaoke/${buildSongSlug(song, artist, hash)}`;
}
