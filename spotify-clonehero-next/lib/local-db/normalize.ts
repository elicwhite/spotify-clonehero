const RE_PARENS = /\([^)]*\)/g;
const RE_BRACKETS = /\[[^\]]*\]/g;
const RE_NON_ALPHANUMERIC = /[^\p{L}\p{N} ]/gu;
const RE_EXTRA_SPACES = /\s+/g;

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

export function normalizeStrForMatching(str: string) {
  // Lower case the string
  let normalized = str.toLowerCase();
  // Fold Latin diacritics only (leave non-Latin scripts intact)
  normalized = foldLatinDiacritics(normalized);

  // Remove everything between "(" and ")"
  normalized = normalized.replace(RE_PARENS, '');

  // Remove everything between "[" and "]"
  normalized = normalized.replace(RE_BRACKETS, '');

  // Remove all non-alphanumeric characters except spaces
  normalized = normalized.replace(RE_NON_ALPHANUMERIC, '');

  // Clean up extra spaces
  normalized = normalized.replace(RE_EXTRA_SPACES, ' ').trim();

  return normalized;
}
