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

/**
 * The song slug to redirect to when a chart path has more than one segment
 * after the tool's prefix, or null when there is none.
 *
 * Two kinds of URL reach this:
 *  - a link that has a raw `/` in a song or artist name
 *    ("Night-Day/Night-<md5>"), which splits the slug;
 *  - a URL pasted onto the end of itself
 *    ("<slug>https:/musiccharts.tools/sheet-music/<slug>" — Next collapses the
 *    `//` of the pasted scheme before routing).
 *
 * In both, the last segment ends in the md5, and the md5 is all the page
 * reads. Takes the route params as Next passes them, percent-encoded, and
 * returns the segment unchanged, so it is ready to go back into a path.
 */
export function findSongSlugInSegments(segments: string[]): null | string {
  const last = segments.at(-1);
  if (!last || getMd5FromSlug(last) == null) {
    return null;
  }
  return last;
}
