/** Matches the dedicated Apple Music connector route, including trailing slashes. */
export function isAppleMusicConnectorRoute(
  pathname: string | null | undefined,
): boolean {
  return (
    pathname === '/apple-music-connect' ||
    /^\/apple-music-connect\/+$/u.test(pathname ?? '')
  );
}

/** Routes that can render or access a browser-local personal taste index. */
export function isTasteDataPrivateRoute(
  pathname: string | null | undefined,
): boolean {
  return (
    isAppleMusicConnectorRoute(pathname) ||
    pathname === '/find-music' ||
    /^\/find-music\//u.test(pathname ?? '')
  );
}
