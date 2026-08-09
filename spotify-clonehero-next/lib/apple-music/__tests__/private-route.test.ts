import {
  isAppleMusicConnectorRoute,
  isTasteDataPrivateRoute,
} from '../private-route';

describe('isAppleMusicConnectorRoute', () => {
  it.each([
    '/apple-music-connect',
    '/apple-music-connect/',
    '/apple-music-connect///',
  ])('matches the connector route that excludes telemetry: %s', pathname => {
    expect(isAppleMusicConnectorRoute(pathname)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    '/',
    '/find-music',
    '/apple-music-connect/child',
    '/apple-music-connect-extra',
    '//apple-music-connect',
  ])('does not match another route: %s', pathname => {
    expect(isAppleMusicConnectorRoute(pathname)).toBe(false);
  });
});

describe('isTasteDataPrivateRoute', () => {
  it.each([
    '/apple-music-connect',
    '/apple-music-connect/',
    '/find-music',
    '/find-music/',
    '/find-music/recommendations',
  ])('matches a route with personal taste data: %s', pathname => {
    expect(isTasteDataPrivateRoute(pathname)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '/',
    '/apple-music-connect/child',
    '/find-musician',
  ])('does not match an ordinary route: %s', pathname => {
    expect(isTasteDataPrivateRoute(pathname)).toBe(false);
  });
});
