/**
 * Syllable splitter using Hypher (TeX hyphenation patterns).
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/syllabify.ts
 */

import Hypher from 'hypher';
import enUS from 'hyphenation.en-us';

const hypher = new Hypher(enUS);

/**
 * Split a word into syllables using TeX hyphenation patterns.
 * Returns the original word unsplit if it's too short or has no hyphenation points.
 */
export function syllabify(word: string): string[] {
  // Strip punctuation for hyphenation, but keep it attached to the result
  const match = word.match(/^([^a-zA-Z]*)(.*?)([^a-zA-Z]*)$/);
  if (!match) return [word];

  const [, prefix, core, suffix] = match;
  if (core.length < 3) return [word];

  const parts = hypher.hyphenate(core);
  if (parts.length <= 1) return [word];

  // Reattach prefix to first part, suffix to last
  parts[0] = prefix + parts[0];
  parts[parts.length - 1] = parts[parts.length - 1] + suffix;

  return parts;
}

/**
 * Split lyrics text into syllables with joinNext and newLine markers.
 *
 * Preserves line breaks from the input: the first syllable of each input line
 * gets `newLine: true` so downstream line-grouping can respect the user's
 * intended phrasing.
 */
export function syllabifyLyrics(
  lyrics: string,
): {text: string; joinNext: boolean; newLine: boolean}[] {
  const inputLines = lyrics
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const result: {text: string; joinNext: boolean; newLine: boolean}[] = [];

  for (const line of inputLines) {
    const words = line.split(/\s+/).filter(Boolean);
    const lineStartIdx = result.length;

    for (const word of words) {
      const syls = syllabify(word);
      for (let i = 0; i < syls.length; i++) {
        result.push({
          text: syls[i],
          joinNext: i < syls.length - 1,
          newLine: result.length === lineStartIdx,
        });
      }
    }
  }

  return result;
}
