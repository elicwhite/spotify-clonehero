const RE_PARENS = /\([^)]*\)/g;
const RE_BRACKETS = /\[[^\]]*\]/g;
const RE_NON_ALPHANUMERIC = /[^a-z0-9]/g;
const RE_EXTRA_SPACES = /\s+/g;

const RE_ACCENTS = /[\u0300-\u036f]/g;

export function normalizeStrForMatching(str: string) {
  // Lower case the string
  let normalized = str.toLowerCase();
  normalized = normalized.normalize('NFD').replace(RE_ACCENTS, '');
  // Remove accents
  // normalized = foldAscii(normalized);

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
