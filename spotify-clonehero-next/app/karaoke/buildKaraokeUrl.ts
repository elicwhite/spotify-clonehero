export function getKaraokeUrl(
  artist: string,
  song: string,
  hash: string,
): string {
  return `/karaoke/${song}-${artist}-${hash}`;
}
