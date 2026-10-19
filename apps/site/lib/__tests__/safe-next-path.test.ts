import {safeNextPath} from '@/lib/safe-next-path';

describe('safeNextPath', () => {
  const fallback = '/account';

  test('keeps a same-origin path with a query string', () => {
    expect(safeNextPath('/sheet-music/abc?x=1', fallback)).toBe(
      '/sheet-music/abc?x=1',
    );
  });

  test('keeps the root path', () => {
    expect(safeNextPath('/', fallback)).toBe('/');
  });

  test.each([
    ['an absolute https URL', 'https://example.com'],
    ['an absolute URL with a path', 'https://example.com/account'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a relative path without a leading slash', 'account'],
    ['a protocol-relative URL', '//example.com'],
    ['a protocol-relative URL with a path', '//example.com/account'],
    ['a backslash after the slash', '/\\example.com'],
    ['a backslash pair', '/\\\\example.com'],
    ['a tab between the slashes', '/\t/example.com'],
    ['a newline between the slashes', '/\n/example.com'],
  ])('rejects %s', (_label, next) => {
    expect(safeNextPath(next, fallback)).toBe(fallback);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('falls back for %s', (_label, next) => {
    expect(safeNextPath(next, fallback)).toBe(fallback);
  });
});
