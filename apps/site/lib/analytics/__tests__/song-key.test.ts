/**
 * The export event's song identifier (plan 0105).
 *
 * Two properties carry the whole feature: the same chart exported twice has
 * to give one key (or the dedup counts re-exports as new charts), and the key
 * must not be reversible into the title (or the page's "nothing about your
 * files leaves the browser" promise is broken).
 */

import {songKey, UNNAMED_SONG} from '../song-key';
import {
  BLANK_CHART_ARTIST,
  BLANK_CHART_NAME,
} from '@/lib/project-storage/blankChart';
import {UNTITLED_CHART_NAME} from '@/lib/chart-export';

test('the same song gives the same key every time', () => {
  expect(songKey('Rush', 'YYZ')).toBe(songKey('Rush', 'YYZ'));
});

test('different songs give different keys', () => {
  expect(songKey('Rush', 'YYZ')).not.toBe(songKey('Rush', 'Limelight'));
  expect(songKey('Rush', 'YYZ')).not.toBe(songKey('Tool', 'YYZ'));
});

test('case and surrounding space do not split one song in two', () => {
  expect(songKey('  RUSH ', 'yyz')).toBe(songKey('Rush', 'YYZ'));
  expect(songKey('Dream  Theater', 'The   Dance of Eternity')).toBe(
    songKey('Dream Theater', 'The Dance of Eternity'),
  );
});

test('a chart with no song identity yet gets no key at all', () => {
  // Every new chart starts with the same two placeholder constants, on every
  // machine. Hashing them would collapse every unnamed chart in the world
  // onto one value and report "1 distinct chart".
  expect(songKey(BLANK_CHART_ARTIST, BLANK_CHART_NAME)).toBe(UNNAMED_SONG);
  expect(songKey(undefined, undefined)).toBe(UNNAMED_SONG);
  expect(songKey('', '')).toBe(UNNAMED_SONG);
  expect(songKey('', UNTITLED_CHART_NAME)).toBe(UNNAMED_SONG);
});

test('the real placeholder constants are the ones this module recognises', () => {
  // `song-key.ts` spells these out to avoid importing two feature modules at
  // runtime. This is what keeps the copies honest: change any of the three
  // constants without following it there and every unnamed chart silently
  // collapses onto one key — the failure the module exists to prevent.
  expect(songKey(BLANK_CHART_ARTIST, BLANK_CHART_NAME)).toBe(UNNAMED_SONG);
  expect(songKey('', UNTITLED_CHART_NAME)).toBe(UNNAMED_SONG);
});

test('a half-named chart still counts as a distinct chart', () => {
  // Only a fully placeholder identity is unidentifiable. A chart with a real
  // title and no artist yet is a real chart.
  expect(songKey(undefined, 'YYZ')).toHaveLength(16);
  expect(songKey('Rush', undefined)).toHaveLength(16);
  expect(songKey(undefined, 'YYZ')).not.toBe(songKey('Rush', 'YYZ'));
});

test('the key carries neither the artist nor the title', () => {
  const key = songKey('Rush', 'YYZ');
  expect(key).toMatch(/^[0-9a-f]{16}$/);
  expect(key.toLowerCase()).not.toContain('rush');
  expect(key.toLowerCase()).not.toContain('yyz');
});
