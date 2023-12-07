const path = require('path');
const fs = require('fs');

const LOCAL_URL = 'http://localhost:4200/api/search/advanced';
const PROD_URL = 'https://www.enchor.us/api/search/advanced';
const CHART_FILE = path.join('.', 'public', 'data', 'charts.json');
const METADATA_FILE = path.join('.', 'public', 'data', 'metadata.json');

const START_TIME = new Date('2011-01-01');
async function run() {
  const results = new Map<string, any>();
  let earliest: Date | null = null;
  let latest: Date | null = START_TIME;
  let totalSongs = 0;
  let newSongs = 0;

  let iterations = 0;
  do {
    newSongs = 0;
    const json = await fetchSongsAfter(latest);

    for (const song of json.data) {
      if (!earliest || new Date(song.modifiedTime) < earliest) {
        earliest = new Date(song.modifiedTime);
      }
      if (!latest || new Date(song.modifiedTime) > latest) {
        latest = new Date(song.modifiedTime);
      }

      if (!results.has(song.md5)) {
        results.set(song.md5, filterKeys(song));
        newSongs++;
        totalSongs++;
      }
    }

    iterations++;
    console.log(newSongs, earliest, latest);
  } while (newSongs > 0 && iterations < 10);

  const res = Array.from(results.values());
  const json = JSON.stringify(res, null, 2);
  fs.writeFileSync(CHART_FILE, json);
  fs.writeFileSync(
    METADATA_FILE,
    JSON.stringify({earliest, latest, totalSongs}, null, 2),
  );
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

run();

async function fetchSongsAfter(date: Date) {
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
      modifiedAfter: date.toISOString().split('T')[0],
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

  return json;
}
