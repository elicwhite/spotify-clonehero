'use server';

export async function searchForChart(
  artist: string,
  song: string,
): Promise<string> {
  const uriComponent = encodeURIComponent(`name="${song}" artist="${artist}"`);
  const response = await fetch(
    `https://chorus.fightthe.pw/api/search?query=${uriComponent}`,
  );
  const json = await response.json();
  return JSON.stringify(json.songs);
}

export async function searchForChartEncoreBasic(
  artist: string,
  song: string,
): Promise<string> {
  const response = await fetch('https://www.enchor.us/api/search', {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      search: `${artist} ${song}`,
      page: 1,
    }),
    method: 'POST',
  });

  const json = await response.json();
  return JSON.stringify(json.data);
}

export async function searchForChartEncore(
  artist: string,
  song: string,
): Promise<string> {
  /*
  API Wish List
  * I wish I didn't need to specify all these empty values. If the API adds a new field, and the user hasn't refreshed the page, those search requests will error
  */
  const response = await fetch('https://www.enchor.us/api/search/advanced', {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: {
        value: song,
        exact: false,
        exclude: false,
      },
      artist: {
        value: artist,
        exact: false,
        exclude: false,
      },

      album: {
        value: '',
        exact: false,
        exclude: false,
      },
      genre: {
        value: '',
        exact: false,
        exclude: false,
      },
      year: {
        value: '',
        exact: false,
        exclude: false,
      },
      charter: {
        value: '',
        exact: false,
        exclude: false,
      },
      instrument: null,
      difficulty: 'expert',
      minLength: null,
      maxLength: null,
      minIntensity: null,
      maxIntensity: null,
      minAverageNPS: null,
      maxAverageNPS: null,
      minMaxNPS: null,
      maxMaxNPS: null,
      modifiedAfter: '',
      hash: '',
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
    }),
    method: 'POST',
  });

  const json = await response.json();
  return JSON.stringify(json.data);
}
