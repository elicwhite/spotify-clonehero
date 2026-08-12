import {parseRateLimit} from 'ratelimit-header-parser';
import {fetchAdvanced} from '../search-encore';

// Debug variable to limit iterations in the future. Leave for full runs.
const MAX_ITERATIONS = Number.MAX_SAFE_INTEGER;

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type FetchNewChartsStats = {
  /**
   * The highest chart id covered by every response handed to `onEachResponse`
   * so far. Resuming a scan with this id picks up exactly where the last
   * handled response left off.
   */
  lastChartId: number;
  newSongsFound: number;
  totalSongsFound: number;
  totalChartsFound: number;
  totalSongsToFetch: number;
};

export type FetchNewChartsOptions = {
  /**
   * Charts recovered from an interrupted run. They seed the dedupe map so a
   * resumed scan returns the full set, not just the charts fetched after the
   * interruption.
   */
  seedCharts?: any[];
  /**
   * The time the (possibly interrupted) run originally started. Recorded as
   * `metadata.lastRun` so a resumed run doesn't skip charts modified while it
   * was running.
   */
  runStartTime?: Date;
};

export default async function fetchNewCharts(
  afterTime: Date,
  scanFromId: number,
  onEachResponse: (json: any[], stats: FetchNewChartsStats) => void,
  options: FetchNewChartsOptions = {},
) {
  const results = new Map<number, any>();
  const runStartTime = options.runStartTime ?? new Date();

  for (const chart of options.seedCharts ?? []) {
    mergeChart(results, chart);
  }

  let lastChartId = scanFromId;

  let totalSongs = results.size;
  let totalCharts = 0;
  let newSongs = 0;
  let iterations = 0;
  let hasMoreCharts = true;

  let totalSongsToFetch = -1;

  do {
    newSongs = 0;
    const json = await fetchSongsAfter(afterTime, lastChartId);

    if (totalSongsToFetch === -1) {
      totalSongsToFetch = json.found;
      console.log('New songs on chorus:', totalSongsToFetch);
    }

    let thisRunLatestChartId = lastChartId;
    for (const song of json.data) {
      totalCharts++;
      if (song.chartId > thisRunLatestChartId) {
        thisRunLatestChartId = song.chartId;
      }

      if (mergeChart(results, song)) {
        newSongs++;
        totalSongs++;
      }
    }

    // Paging is driven by the chart id cursor, not by how many of the charts
    // were new: a page can be entirely updates to songs we already have and
    // still be followed by more pages.
    hasMoreCharts = json.data.length > 0 && thisRunLatestChartId > lastChartId;

    const stats = {
      lastChartId: thisRunLatestChartId,
      newSongsFound: newSongs,
      totalSongsFound: totalSongs,
      totalChartsFound: totalCharts,
      totalSongsToFetch,
    };

    iterations++;
    console.log({
      fetchAfter: afterTime.toISOString(),
      lastChartIDFetched: thisRunLatestChartId,

      ...stats,
    });

    lastChartId = thisRunLatestChartId;
    onEachResponse(json.data.map(filterKeys), stats);
  } while (hasMoreCharts && iterations < MAX_ITERATIONS);

  return {
    charts: Array.from(results.values()),
    metadata: {
      lastRun: runStartTime.toISOString(),
      totalSongs,
    },
  };
}

/** Returns true when the chart introduces a song we hadn't seen yet. */
function mergeChart(results: Map<number, any>, song: any): boolean {
  const existing = results.get(song.groupId);

  if (existing == null) {
    results.set(song.groupId, filterKeys(song));
    return true;
  }

  if (new Date(existing.modifiedTime) < new Date(song.modifiedTime)) {
    results.set(song.groupId, filterKeys(song));
  }

  return false;
}

const saveKeys = [
  'name',
  'artist',
  'album',
  'genre',
  'year',
  'albumArtMd5',
  'md5',
  'groupId',
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
  'notesData',
] as const;

type SaveKeys = (typeof saveKeys)[number];

export function filterKeys(chart: Object) {
  const result: Record<string, any> = {};
  for (const key in chart) {
    if (saveKeys.includes(key as SaveKeys)) {
      // @ts-ignore
      result[key] = chart[key];
    }
  }

  // @ts-ignore
  const notesData = result['notesData'];
  if (notesData != null && typeof notesData === 'object') {
    const filteredNotesData: Record<string, unknown> = {};
    if (Array.isArray(notesData['instruments'])) {
      filteredNotesData['instruments'] = notesData['instruments'];
    }
    if ('drumType' in notesData) {
      filteredNotesData['drumType'] = notesData['drumType'];
    }
    if (Array.isArray(notesData['trackHashes'])) {
      filteredNotesData['trackHashes'] = notesData['trackHashes'].map(
        (track: {instrument: string; difficulty: string}) => ({
          instrument: track.instrument,
          difficulty: track.difficulty,
        }),
      );
    }
    result['notesData'] = filteredNotesData;
  }

  return result;
}

async function fetchSongsAfter(date: Date, lastChartId: number): Promise<any> {
  const response = await fetchAdvanced({
    // in YYYY-MM-DD format
    modifiedAfter: date.toISOString(),
    chartIdAfter: lastChartId,
  });
  // const response = await fetch(PROD_URL, {
  //   headers: {
  //     accept: 'application/json, text/plain, */*',
  //     'accept-language': 'en-US,en;q=0.9',
  //     'content-type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     instrument: null,
  //     difficulty: null,
  //     drumType: null,
  //     source: 'website',
  //     name: {value: '', exact: false, exclude: false},
  //     artist: {value: '', exact: false, exclude: false},
  //     album: {value: '', exact: false, exclude: false},
  //     genre: {value: '', exact: false, exclude: false},
  //     year: {value: '', exact: false, exclude: false},
  //     charter: {value: '', exact: false, exclude: false},
  //     minLength: null,
  //     maxLength: null,
  //     minIntensity: null,
  //     maxIntensity: null,
  //     minAverageNPS: null,
  //     maxAverageNPS: null,
  //     minMaxNPS: null,
  //     maxMaxNPS: null,
  //     minYear: null,
  //     maxYear: null,
  //     // in YYYY-MM-DD format
  //     modifiedAfter: date.toISOString(),
  //     hash: '',
  //     trackHash: '',
  //     hasSoloSections: null,
  //     hasForcedNotes: null,
  //     hasOpenNotes: null,
  //     hasTapNotes: null,
  //     hasLyrics: null,
  //     hasVocals: null,
  //     hasRollLanes: null,
  //     has2xKick: null,
  //     hasIssues: null,
  //     hasVideoBackground: null,
  //     modchart: null,
  //     chartIdAfter: lastChartId,
  //     per_page: 250,
  //   }),
  //   method: 'POST',
  // });

  if (response.ok) {
    return await response.json();
  } else if (response.status == 429) {
    const result = parseRateLimit(response.headers);
    const msTillResult =
      result?.remaining === 0 && result?.reset
        ? result.reset.getTime() - Date.now()
        : 1000;

    if (msTillResult > 0) {
      console.log(
        'Rate limited, waiting',
        Math.round(msTillResult / 4),
        'seconds',
      );
      await delay(msTillResult);
    }
    return await fetchSongsAfter(date, lastChartId);
  } else {
    // 5xx responses are already retried and turned into a
    // ChorusUnavailableError inside search-encore, so anything left here is a
    // client error worth reporting.
    throw new Error(
      `Fetching charts from Chorus failed with status ${response.status}: ${response.statusText}`,
    );
  }
}
