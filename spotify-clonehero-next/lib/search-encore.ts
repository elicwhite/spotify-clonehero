import {ChartResponseEncore} from './chartSelection';

export type EncoreResponse = {
  found: number;
  out_of: number;
  data: ChartResponseEncore[];
};

export async function searchEncore(
  search: string,
  instrument: undefined | null | string,
): Promise<EncoreResponse> {
  const response = await fetch('https://api.enchor.us/search', {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      search: search,
      page: 1,
      instrument: instrument ?? null,
      difficulty: null,
      drumType: null,
      source: 'website',
    }),
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(
      `Search failed with status ${response.status}: ${response.statusText}`,
    );
  }

  const json = await response.json();
  return {
    ...json,
    data: json.data.map((chart: ChartResponseEncore) => ({
      ...chart,
      file: `https://files.enchor.us/${chart.md5}.sng`,
    })),
  };
}
