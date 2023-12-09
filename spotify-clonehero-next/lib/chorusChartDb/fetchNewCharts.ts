const LOCAL_URL = 'http://localhost:4200/api/search/advanced';
const PROD_URL = 'https://www.enchor.us/api/search/advanced';

// Debug variable to limit iterations in the future. Leave for full runs.
const MAX_ITERATIONS = Number.MAX_SAFE_INTEGER;

export default async function fetchNewCharts(
  afterTime: Date,
  onEachResponse: (json: any[], lastChartId: number) => void,
) {
  const results = new Map<string, any>();
  const runStartTime = new Date();

  let lastChartId = 1;

  let totalSongs = 0;
  let newSongs = 0;
  let iterations = 0;

  do {
    newSongs = 0;
    const json = await fetchSongsAfter(afterTime, lastChartId);

    let thisRunLatestChartId = lastChartId;
    for (const song of json.data) {
      if (song.chartId > thisRunLatestChartId) {
        thisRunLatestChartId = song.chartId;
      }

      if (!results.has(song.md5)) {
        results.set(song.md5, filterKeys(song));
        newSongs++;
        totalSongs++;
      } else {
        const existing = results.get(song.md5);
        if (new Date(existing.modifiedTime) < new Date(song.modifiedTime)) {
          results.set(song.md5, filterKeys(song));
        }
      }
    }

    iterations++;
    console.log(
      afterTime.toISOString(),
      lastChartId,
      thisRunLatestChartId,
      newSongs,
      json.data.length,
      totalSongs,
    );
    lastChartId = thisRunLatestChartId;

    onEachResponse(json.data.map(filterKeys), lastChartId);

    // console.log(newSongs, earliest, latest);
  } while (newSongs > 0 && iterations < MAX_ITERATIONS);

  return {
    charts: Array.from(results.values()),
    metadata: {
      lastRun: runStartTime.toISOString(),
      totalSongs,
    },
  };
}

const saveKeys = [
  'name',
  'artist',
  'album',
  'genre',
  'year',
  'md5',
  'charter',
  'song_length',
  'diff_band',
  'diff_guitar',
  'diff_guitar_coop',
  'diff_rhythm',
  'diff_bass',
  'diff_drums',
  'diff_drums_real',
  'diff_keys',
  'diff_guitarghl',
  'diff_guitar_coop_ghl',
  'diff_rhythm_ghl',
  'diff_bassghl',
  'diff_vocals',
  'five_lane_drums',
  'pro_drums',
  'hasLyrics',
  'has2xKick',
  'hasVideoBackground',
  'modifiedTime',
] as const;

type SaveKeys = (typeof saveKeys)[number];

function filterKeys(chart: Object) {
  const result: {[key: string]: number | string} = {};
  for (const key in chart) {
    if (saveKeys.includes(key as SaveKeys)) {
      // @ts-ignore
      result[key] = chart[key];
    }
  }

  return result;
}

async function fetchSongsAfter(date: Date, lastChartId: number) {
  const response = await fetch(PROD_URL, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      instrument: null,
      difficulty: null,
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
      // in YYYY-MM-DD format
      modifiedAfter: date.toISOString(),
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
      chartIdAfter: lastChartId,
    }),
    method: 'POST',
  });

  const json = await response.json();

  return json;
}
