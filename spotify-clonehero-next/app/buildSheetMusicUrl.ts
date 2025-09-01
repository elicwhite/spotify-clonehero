export function getSheetMusicUrl(
  artist: string,
  song: string,
  hash: string,
): string {
  return `/sheet-music/${song}-${artist}-${hash}`;
}
