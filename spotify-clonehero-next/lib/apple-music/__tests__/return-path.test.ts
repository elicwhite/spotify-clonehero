import {safeAppleMusicReturnPath} from '../return-path';

describe('safeAppleMusicReturnPath', () => {
  it.each(['/find-music', '/find-music/recommendations'])(
    'allows the exact Find Music route %s',
    path => {
      expect(safeAppleMusicReturnPath(path)).toBe(path);
    },
  );

  it.each([
    null,
    '',
    '/',
    '/find-music/',
    '/find-music?connected=1',
    '/find-music/recommendations/',
    '/find-music/other',
    '//example.com',
    'https://example.com',
  ])('falls back for any non-allowlisted return path: %s', value => {
    expect(safeAppleMusicReturnPath(value)).toBe('/find-music');
  });
});
