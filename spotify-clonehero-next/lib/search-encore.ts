import {ChartResponseEncore} from './chartSelection';

const LOCAL_URL = 'http://localhost:4200/api/search/advanced';
const PROD_URL = 'https://api.enchor.us/search/advanced';

export type EncoreResponse = {
  found: number;
  out_of: number;
  data: ChartResponseEncore[];
};

export async function searchEncore(
  search: string,
  instrument: undefined | null | string,
  page: number = 1,
): Promise<EncoreResponse> {
  const response = await fetch('https://api.enchor.us/search', {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      search: search,
      page: page,
      instrument: instrument ?? null,
      difficulty: null,
      drumType: null,
      source: 'website',
      ...(instrument === 'drums' ? {drumsReviewed: false} : {}),
    }),
    method: 'POST',
  });

  return processResponse(response);
}

async function processResponse(response: Response) {
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

export async function searchAdvanced(options: Object): Promise<EncoreResponse> {
  const response = await fetchAdvanced(options);
  return processResponse(response);
}

export async function fetchAdvanced(options: Object) {
  return await fetch(PROD_URL, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      instrument: null,
      difficulty: null,
      drumType: null,
      source: 'website',
      name: {value: '', exact: false, exclude: false},
      artist: {value: '', exact: false, exclude: false},
      album: {value: '', exact: false, exclude: false},
      genre: {value: '', exact: false, exclude: false},
      year: {value: '', exact: false, exclude: false},
      charter: {value: '', exact: false, exclude: false},
      minLength: null,
      maxLength: null,
      minIntensity: null,
      maxIntensity: null,
      minAverageNPS: null,
      maxAverageNPS: null,
      minMaxNPS: null,
      maxMaxNPS: null,
      minYear: null,
      maxYear: null,
      // in YYYY-MM-DD format
      modifiedAfter: null,
      hash: '',
      trackHash: '',
      hasSoloSections: null,
      hasForcedNotes: null,
      hasOpenNotes: null,
      hasTapNotes: null,
      hasLyrics: null,
      hasVocals: null,
      hasRollLanes: null,
      has2xKick: null,
      hasIssues: null,
      hasVideoBackground: null,
      modchart: null,
      chartIdAfter: 1,
      per_page: 250,
      ...options,
    }),
    method: 'POST',
  });
}
