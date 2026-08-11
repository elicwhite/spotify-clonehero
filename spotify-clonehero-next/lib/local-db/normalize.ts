const RE_PARENS = /\([^)]*\)/g;
const RE_BRACKETS = /\[[^\]]*\]/g;
const RE_NON_ALPHANUMERIC = /[^\p{L}\p{N} ]/gu;
const RE_EXTRA_SPACES = /\s+/g;
const RE_LEADING_ARTICLE = /^(the|a|an) /;

// Spotify writes edition labels as a hyphen suffix ("Comfortably Numb -
// Remastered 2011") where Chorus writes them parenthetically. Parens are
// already stripped above, so only the hyphen form needs handling. The keyword
// list is deliberately curated: a bare "Song - Part Two" is a title, not an
// edition, and must survive.
const EDITION_KEYWORDS = [
  'remaster(ed)?',
  'live',
  'mono',
  'stereo',
  'acoustic',
  'demo',
  'instrumental',
  'reissue',
  'deluxe',
  'anniversary',
  're-?recorded',
  'radio edit',
  'single version',
  'album version',
  'extended version',
  'original mix',
  'edit',
  'mix',
  'version',
].join('|');
const RE_EDITION_SUFFIX = new RegExp(
  `\\s-\\s[^-]*\\b(?:${EDITION_KEYWORDS})\\b.*$`,
);

// "Song feat. Someone" and "Artist ft Someone". Chorus and the providers
// disagree about whether the guest is part of the name at all, so the guest is
// dropped from both sides rather than matched.
const RE_FEATURE = /\s(?:feat|ft|featuring)\b\.?\s.*$/;

// "&" and "and" are the same word to a listener and to a charter.
const RE_CONJUNCTION = /\s*[&+]\s*/g;

const RE_MARK = /\p{M}/u;
const RE_LATIN = /\p{Script=Latin}/u;

export function foldLatinDiacritics(s: string): string {
  // NFD exposes combining marks.
  const nfd = s.normalize('NFD');
  let out = '';
  let prevWasLatin = false;

  for (const ch of nfd) {
    if (RE_MARK.test(ch)) {
      // Drop marks only if the previous base char was Latin.
      if (prevWasLatin) continue;
      out += ch; // keep marks for non-Latin scripts (rarely present)
      continue;
    }
    out += ch;
    prevWasLatin = RE_LATIN.test(ch);
  }
  return out.normalize('NFC');
}

function dropSuffix(value: string, pattern: RegExp): string {
  const stripped = value.replace(pattern, '');
  return stripped.trim() === '' ? value : stripped;
}

export function normalizeStrForMatching(str: string) {
  // Lower case the string
  let normalized = str.toLowerCase();
  // Fold Latin diacritics only (leave non-Latin scripts intact)
  normalized = foldLatinDiacritics(normalized);

  // Remove everything between "(" and ")"
  normalized = normalized.replace(RE_PARENS, '');

  // Remove everything between "[" and "]"
  normalized = normalized.replace(RE_BRACKETS, '');

  // Drop edition and guest-artist suffixes while their punctuation survives.
  // Both are dropped only when something is left to match on.
  normalized = dropSuffix(normalized, RE_EDITION_SUFFIX);
  normalized = dropSuffix(normalized, RE_FEATURE);

  // Treat "&" and "+" as the word they are read as
  normalized = normalized.replace(RE_CONJUNCTION, ' and ');

  // Remove all non-alphanumeric characters except spaces
  normalized = normalized.replace(RE_NON_ALPHANUMERIC, '');

  // Clean up extra spaces
  normalized = normalized.replace(RE_EXTRA_SPACES, ' ').trim();

  // Strip leading articles ("the", "a", "an")
  normalized = normalized.replace(RE_LEADING_ARTICLE, '');

  return normalized;
}
