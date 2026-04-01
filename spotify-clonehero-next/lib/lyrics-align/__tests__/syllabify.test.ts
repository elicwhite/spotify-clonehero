import {describe, test, expect} from '@jest/globals';
import {syllabify, syllabifyLyrics} from '../syllabify';

describe('syllabify', () => {
  test('splits "diamonds" into syllables', () => {
    expect(syllabify('diamonds')).toEqual(['di', 'a', 'monds']);
  });

  test('splits "better" into syllables', () => {
    expect(syllabify('better')).toEqual(['bet', 'ter']);
  });

  test('splits "every" — single part (no hyphenation point)', () => {
    expect(syllabify('every')).toEqual(['every']);
  });

  test('leaves short words (< 3 chars) unsplit', () => {
    expect(syllabify('it')).toEqual(['it']);
    expect(syllabify('a')).toEqual(['a']);
  });

  test('preserves trailing punctuation on last syllable', () => {
    expect(syllabify('better!')).toEqual(['bet', 'ter!']);
  });

  test('leading non-alpha is treated as prefix (but "hello" is unsplit)', () => {
    // '"hello' — prefix='"', core='hello'; hypher returns ['hello'] (unsplit) → returns original
    expect(syllabify('"hello')).toEqual(['"hello']);
  });

  test('literal hyphen inside word: hypher treats it as a split point', () => {
    // hypher.hyphenate('well-known') → ['well-', 'known']
    expect(syllabify('well-known')).toEqual(['well-', 'known']);
  });

  test('single-syllable words are returned unsplit', () => {
    expect(syllabify('cat')).toEqual(['cat']);
    expect(syllabify('strength')).toEqual(['strength']);
  });

  test('multi-syllable common words', () => {
    expect(syllabify('beautiful')).toEqual(['beau', 'ti', 'ful']);
    expect(syllabify('remember')).toEqual(['re', 'mem', 'ber']);
  });
});

describe('syllabifyLyrics', () => {
  test('splits a single word into syllables', () => {
    const result = syllabifyLyrics('diamonds');
    expect(result).toEqual([
      {text: 'di', joinNext: true, newLine: true},
      {text: 'a', joinNext: true, newLine: false},
      {text: 'monds', joinNext: false, newLine: false},
    ]);
  });

  test('splits "better" into syllables', () => {
    const result = syllabifyLyrics('better');
    expect(result).toEqual([
      {text: 'bet', joinNext: true, newLine: true},
      {text: 'ter', joinNext: false, newLine: false},
    ]);
  });

  test('multiple words on one line', () => {
    const result = syllabifyLyrics('shine bright like a diamond');
    // "diamond" → ["di", "a", "mond"] (3 syllables)
    expect(result.map(s => s.text)).toEqual([
      'shine', 'bright', 'like', 'a', 'di', 'a', 'mond',
    ]);
    expect(result.find(s => s.text === 'di')?.joinNext).toBe(true);
    expect(result.find(s => s.text === 'mond')?.joinNext).toBe(false);
  });

  test('newLine flag marks first syllable of each input line', () => {
    const result = syllabifyLyrics('hello world\ngoodbye');
    expect(result[0].newLine).toBe(true);
    expect(result[1].newLine).toBe(false);
    const goodbyeIdx = result.findIndex(s => s.text === 'good');
    expect(goodbyeIdx).toBeGreaterThan(0);
    expect(result[goodbyeIdx].newLine).toBe(true);
  });

  test('empty input returns empty array', () => {
    expect(syllabifyLyrics('')).toEqual([]);
  });
});
