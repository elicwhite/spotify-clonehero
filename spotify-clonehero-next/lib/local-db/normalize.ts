export function normalizeStrForMatching(str: string) {
  // Lower case the string
  let normalized = str.toLowerCase();
  normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Remove everything between "(" and ")"
  normalized = normalized.replace(/\([^)]*\)/g, '');

  // Remove everything between "[" and "]"
  normalized = normalized.replace(/\[[^\]]*\]/g, '');

  // Remove all non-alphanumeric characters except spaces
  normalized = normalized.replace(/[^a-z0-9 ]/g, '');

  // Clean up extra spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Remove accents

  return normalized;
}
