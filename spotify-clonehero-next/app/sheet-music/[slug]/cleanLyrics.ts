import {removeStyleTags} from '@/lib/ui-utils';

// Taken from https://github.com/YARC-Official/YARG.Core/blob/e0f51a87272887b5d6416f06622ce4d235a383a9/YARG.Core/Chart/Tracks/Lyrics/LyricSymbols.cs#L34

// Symbols that should be stripped from lyrics in vocals
const VOCALS_STRIP_SYMBOLS = new Set([
  '+', // PITCH_SLIDE_SYMBOL
  '#', // NONPITCHED_SYMBOL
  '^', // NONPITCHED_LENIENT_SYMBOL
  '*', // NONPITCHED_UNKNOWN_SYMBOL
  '%', // RANGE_SHIFT_SYMBOL
  '/', // STATIC_SHIFT_SYMBOL
  '$', // HARMONY_HIDE_SYMBOL
  '"', // Quotation marks
]);

// Symbols that should be replaced with another in vocals
const VOCALS_SYMBOL_REPLACEMENTS = new Map([
  ['=', '-'], // LYRIC_JOIN_HYPHEN_SYMBOL -> hyphen
  ['§', '‿'], // JOINED_SYLLABLE_SYMBOL -> tie character
  ['_', ' '], // SPACE_ESCAPE_SYMBOL -> space
]);

const RE_ESCAPE_CHARS = /[.*+?^${}()|[\]\\]/g;

/**
 * Cleans lyrics for vocals display by stripping special symbols and replacing others.
 * This is equivalent to YARG.Core's StripForVocals method.
 *
 * @param lyrics - The raw lyrics string to clean
 * @returns The cleaned lyrics string suitable for vocals display
 */
function cleanLyrics(lyrics: string): string {
  if (!lyrics) return lyrics;

  // First, remove rich text tags
  let cleaned = removeStyleTags(lyrics);

  // Strip symbols that should be completely removed
  for (const symbol of VOCALS_STRIP_SYMBOLS) {
    cleaned = cleaned.replace(
      new RegExp(symbol.replace(RE_ESCAPE_CHARS, '\\$&'), 'g'),
      '',
    );
  }

  // Replace symbols that should be substituted
  for (const [symbol, replacement] of VOCALS_SYMBOL_REPLACEMENTS) {
    cleaned = cleaned.replace(
      new RegExp(symbol.replace(RE_ESCAPE_CHARS, '\\$&'), 'g'),
      replacement,
    );
  }

  return cleaned;
}

export default cleanLyrics;
