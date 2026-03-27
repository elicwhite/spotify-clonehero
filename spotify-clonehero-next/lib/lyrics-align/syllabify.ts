/**
 * Syllable splitter using Hypher (TeX hyphenation patterns).
 *
 * Strategy: split all words at hyphenation points, then after CTC alignment,
 * merge syllables whose timestamps are too close together. This matches how
 * music charts work — they only split syllables that are actually drawn out
 * in the singing, not every linguistic syllable.
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
  const inputLines = lyrics.split(/\n/).map(l => l.trim()).filter(Boolean);
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

/**
 * Merge aligned syllables that are too close together.
 *
 * After CTC alignment, syllables within a word that have nearly identical
 * timestamps should be merged back into one — they weren't drawn out enough
 * to warrant separate timing. This matches how music charts only split
 * syllables for long, drawn-out words.
 *
 * @param minGapMs Minimum gap between syllables to keep them split (default 80ms)
 */
export function mergeCloseSyllables<
  T extends {text: string; startMs: number; joinNext: boolean},
>(syllables: T[], minGapMs: number = 80): T[] {
  if (syllables.length <= 1) return syllables;

  const result: T[] = [syllables[0]];

  for (let i = 1; i < syllables.length; i++) {
    const prev = result[result.length - 1];
    const curr = syllables[i];

    // Merge if: same word (prev.joinNext) AND gap is too small
    if (prev.joinNext && curr.startMs - prev.startMs < minGapMs) {
      // Merge into previous: combine text, keep prev's startMs
      result[result.length - 1] = {
        ...prev,
        text: prev.text + curr.text,
        joinNext: curr.joinNext,
      };
    } else {
      result.push(curr);
    }
  }

  return result;
}
