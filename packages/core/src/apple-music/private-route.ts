/** Matches the dedicated Apple Music connector route, including trailing slashes. */
export function isAppleMusicConnectorRoute(
  pathname: string | null | undefined,
): boolean {
  return (
    pathname === '/apple-music-connect' ||
    /^\/apple-music-connect\/+$/u.test(pathname ?? '')
  );
}

/**
 * Routes whose DOM shows the user's own library: song, artist, album and
 * playlist names.
 *
 * This gates Session Replay and the WebMCP debug tools, and nothing else.
 * Errors from these routes are reported, and Google Analytics runs on them —
 * what a user did is useful, which songs they did it to is not. Replay is
 * excluded because it captures the page rather than an event we chose to send,
 * so it is the one mechanism that cannot honour that distinction.
 */
export function rendersPersonalTasteData(
  pathname: string | null | undefined,
): boolean {
  return (
    isAppleMusicConnectorRoute(pathname) ||
    pathname === '/find-music' ||
    /^\/find-music\//u.test(pathname ?? '')
  );
}
