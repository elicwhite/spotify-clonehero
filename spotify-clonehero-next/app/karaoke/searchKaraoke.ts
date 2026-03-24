import {searchAdvanced, type EncoreResponse} from '@/lib/search-encore';

/**
 * Search Enchor for charts with lyrics. Searches both name and artist
 * fields in parallel so "green day" finds songs BY Green Day as well
 * as songs with "green day" in the title.
 */
export async function searchKaraoke(query: string): Promise<EncoreResponse> {
  if (!query) {
    const results = await searchAdvanced({hasLyrics: true, per_page: 50});
    return dedupeResponse(results);
  }

  const [byName, byArtist] = await Promise.all([
    searchAdvanced({
      name: {value: query, exact: false, exclude: false},
      hasLyrics: true,
      per_page: 50,
    }),
    searchAdvanced({
      artist: {value: query, exact: false, exclude: false},
      hasLyrics: true,
      per_page: 50,
    }),
  ]);

  const combined = [...byName.data, ...byArtist.data];
  const deduped = Array.from(
    new Map(combined.map(c => [c.md5, c])).values(),
  );

  return {
    found: deduped.length,
    out_of: byName.out_of,
    data: deduped,
  };
}

function dedupeResponse(response: EncoreResponse): EncoreResponse {
  const deduped = Array.from(
    new Map(response.data.map(c => [c.md5, c])).values(),
  );
  return {...response, data: deduped};
}
