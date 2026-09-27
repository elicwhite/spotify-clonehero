/**
 * The `<song>-<artist>-<md5>` path segment that names one chart in
 * `/sheet-music/[slug]` and `/karaoke/[slug]`.
 *
 * Only the md5 identifies the chart. The song and artist are there so the URL
 * reads as the song, so they are percent-encoded: a `/`, `?`, `#` or `%` in a
 * name would otherwise split the path, start a query string or fragment, or
 * make an invalid escape, and the md5 would not reach the page.
 */
export function buildSongSlug(
  song: string,
  artist: string,
  hash: string,
): string {
  return `${encodeURIComponent(song)}-${encodeURIComponent(artist)}-${hash}`;
}

/**
 * The md5 at the end of a song slug, or null when the slug does not end in
 * one. The md5 is hex, so the slug can be percent-encoded or decoded.
 */
export function getMd5FromSlug(slug: string): null | string {
  const possibleHash = slug.split('-').pop();
  // validate split is a valid md5
  if (!possibleHash || possibleHash.length !== 32) {
    return null;
  }
  return possibleHash;
}
