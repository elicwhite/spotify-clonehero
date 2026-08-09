import {ChartResponseEncore} from './chartSelection';
import {ChorusUnavailableError} from './chorus-errors';

const PROD_URL = 'https://api.enchor.us/search/advanced';
const SEARCH_URL = 'https://api.enchor.us/search';

/** Retries after the initial attempt, so at most 4 requests are made. */
export const ENCORE_MAX_RETRIES = 3;
const ENCORE_RETRY_BASE_MS = 1000;

export type EncoreResponse = {
  found: number;
  out_of: number;
  data: ChartResponseEncore[];
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * POSTs to the Encore API, retrying server errors (5xx) and network failures
 * with exponential backoff. Rate limits (429) and other 4xx responses are
 * returned as-is so callers can handle them; a request that never succeeds
 * throws a {@link ChorusUnavailableError}.
 */
async function postEncore(url: string, body: Object): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        method: 'POST',
      });
    } catch (error) {
      if (attempt >= ENCORE_MAX_RETRIES) {
        throw new ChorusUnavailableError(undefined, {cause: error});
      }
      await delay(ENCORE_RETRY_BASE_MS * 2 ** attempt);
      continue;
    }

    if (response.status < 500) {
      return response;
    }

    if (attempt >= ENCORE_MAX_RETRIES) {
      throw new ChorusUnavailableError(response.status);
    }

    console.log(
      `Chorus responded ${response.status}, retrying (attempt ${attempt + 1} of ${ENCORE_MAX_RETRIES})`,
    );
    await delay(ENCORE_RETRY_BASE_MS * 2 ** attempt);
  }
}

export async function searchEncore(
  search: string,
  instrument: undefined | null | string,
  page: number = 1,
): Promise<EncoreResponse> {
  const response = await postEncore(SEARCH_URL, {
    search: search,
    page: page,
    instrument: instrument ?? null,
    difficulty: null,
    drumType: null,
    source: 'website',
    ...(instrument === 'drums' ? {drumsReviewed: false} : {}),
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
  return await postEncore(PROD_URL, {
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
  });
}
