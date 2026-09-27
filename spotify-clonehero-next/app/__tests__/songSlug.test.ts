import {normalizeRepeatedSlashes} from 'next/dist/shared/lib/utils';

import {getSheetMusicUrl} from '@/app/buildSheetMusicUrl';
import {getKaraokeUrl} from '@/app/karaoke/buildKaraokeUrl';
import {buildSongSlug, getMd5FromSlug} from '@/app/songSlug';

const ORIGIN = 'https://musiccharts.tools';
const MD5 = '0123456789abcdef0123456789abcdef';

/**
 * The route params Next hands the page for a link, the way a click gets
 * there: the browser resolves the href, the server collapses repeated
 * slashes, and the router splits the path into percent-encoded segments.
 */
function routeSegments(href: string): {
  segments: string[];
  search: string;
  hash: string;
} {
  const url = new URL(href, ORIGIN);
  const pathname = normalizeRepeatedSlashes(url.pathname);
  return {
    segments: pathname.split('/').slice(1),
    search: url.search,
    hash: url.hash,
  };
}

describe('buildSongSlug', () => {
  it.each([
    ['plain names', 'Plain Song', 'Plain Band'],
    ['a slash', 'Night/Day', 'Up/Down'],
    ['a question mark', 'Where To?', 'Who?'],
    ['a hash sign', 'Track #9', 'The #s'],
    ['a percent sign', '100% Proof', '50%'],
    ['accents', 'Canção Tôrta', 'Ána Júlia'],
    ['hyphens', 'Re-Run', 'Twenty-One'],
    ['an ampersand and a plus', 'Salt & Pepper', 'A+B'],
  ])('keeps a name with %s in one segment', (_label, song, artist) => {
    const {segments, search, hash} = routeSegments(
      getSheetMusicUrl(artist, song, MD5),
    );

    expect(search).toBe('');
    expect(hash).toBe('');
    expect(segments.map(decodeURIComponent)).toEqual([
      'sheet-music',
      `${song}-${artist}-${MD5}`,
    ]);
    expect(getMd5FromSlug(segments[1])).toBe(MD5);
  });

  it('keeps plain names readable', () => {
    expect(buildSongSlug('Plain Song', 'Plain Band', MD5)).toBe(
      `Plain%20Song-Plain%20Band-${MD5}`,
    );
  });

  it('builds the karaoke URL from the same slug', () => {
    const {segments, search, hash} = routeSegments(
      getKaraokeUrl('Up/Down', 'Where To?', MD5),
    );

    expect(search).toBe('');
    expect(hash).toBe('');
    expect(segments.map(decodeURIComponent)).toEqual([
      'karaoke',
      `Where To?-Up/Down-${MD5}`,
    ]);
  });
});

describe('getMd5FromSlug', () => {
  it('reads the md5 after the last hyphen', () => {
    expect(getMd5FromSlug(`Re-Run-Twenty-One-${MD5}`)).toBe(MD5);
  });

  it('rejects a slug that does not end in an md5', () => {
    expect(getMd5FromSlug('Plain Song-Plain Band')).toBeNull();
    expect(getMd5FromSlug(`Plain Song-Plain Band-${MD5}https:`)).toBeNull();
  });
});
