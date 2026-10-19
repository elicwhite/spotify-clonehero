import {parseRateLimit} from 'ratelimit-header-parser';
import {fetchAdvanced} from '../search-encore';
import {
  isNewerChorusChart,
  toChorusChartDbRow,
  type ChorusApiChart,
  type ChorusChartDbRow,
} from './types';

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
  seedCharts?: ChorusChartDbRow[];
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
  onEachResponse: (
    json: ChorusChartDbRow[],
    stats: FetchNewChartsStats,
  ) => void,
  options: FetchNewChartsOptions = {},
) {
  const results = new Map<string, ChorusChartDbRow>();
  const runStartTime = options.runStartTime ?? new Date();

  // Seeds come from a dump published by an older generation of this code, so
  // they are re-narrowed on the way in. This is where a row written under a
  // previous contract — a `year` that was still free text, say — is brought up
  // to the shape the next dump promises.
  for (const chart of options.seedCharts ?? []) {
    const row = toChorusChartDbRow(chart);
    if (row != null) mergeChart(results, row);
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
    onEachResponse(json.data, stats);
  } while (hasMoreCharts && iterations < MAX_ITERATIONS);

  return {
    charts: Array.from(results.values()),
    metadata: {
      lastRun: runStartTime.toISOString(),
      totalSongs,
    },
  };
}

/**
 * Encore's `groupId` is the negated `versionGroupId`, so it is negative on
 * every real chart — charts that are revisions of the same upload share one
 * value. Only `0` means Encore reported no group, and then the chart stands
 * alone under its own hash. Testing for a positive id here would group nothing
 * at all and emit one dump row per chart instead of per upload.
 */
export function chartGroupKey(
  chart: Pick<ChorusChartDbRow, 'groupId' | 'md5'>,
): string {
  return chart.groupId !== 0 ? `group:${chart.groupId}` : `chart:${chart.md5}`;
}

/** Returns true when the chart introduces a song we hadn't seen yet. */
function mergeChart(
  results: Map<string, ChorusChartDbRow>,
  song: ChorusChartDbRow,
): boolean {
  const key = chartGroupKey(song);
  const existing = results.get(key);

  if (existing == null) {
    results.set(key, song);
    return true;
  }

  if (isNewerChorusChart(song, existing)) {
    results.set(key, song);
  }

  return false;
}

async function fetchSongsAfter(
  date: Date,
  lastChartId: number,
): Promise<{found: number; data: ChorusApiChart[]}> {
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
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body == null) {
      throw new Error('Chorus returned an invalid chart page');
    }
    const source = body as Record<string, unknown>;
    if (!Array.isArray(source['data'])) {
      throw new Error('Chorus returned an invalid chart list');
    }
    return {
      found: typeof source['found'] === 'number' ? source['found'] : 0,
      data: source['data'].map(toApiChart).filter(row => row != null),
    };
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

/**
 * `chartId` drives the paging cursor, so a row without a usable one would
 * silently stall or restart the crawl. That is worth failing loudly for; a
 * chart whose metadata we cannot use is not.
 */
function toApiChart(value: unknown): ChorusApiChart | null {
  if (typeof value !== 'object' || value == null) {
    throw new Error('Chorus returned an invalid chart row');
  }
  const source = value as Record<string, unknown>;
  if (
    typeof source['chartId'] !== 'number' ||
    !Number.isInteger(source['chartId'])
  ) {
    throw new Error('Chorus returned a chart row without a valid chartId');
  }
  const row = toChorusChartDbRow(source);
  return row && {...row, chartId: source['chartId']};
}
