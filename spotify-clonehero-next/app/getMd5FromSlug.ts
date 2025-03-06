export function getMd5FromSlug(slug: string): null | string {
  const possibleHash = slug.split('-').pop();
  // validate split is a valid md5
  if (!possibleHash || possibleHash.length !== 32) {
    return null;
  }
  return possibleHash;
}
