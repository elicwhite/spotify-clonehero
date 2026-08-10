import path from 'path';
import fs from 'fs';
import fetchNewCharts from './lib/chorusChartDb/fetchNewCharts';
import {
  findResumableRun,
  newRunDir,
  readSavedCharts,
  RunState,
  saveBatch,
  writeRunState,
} from './lib/chorusChartDb/rawRunFiles';
import {
  ChartDbManifest,
  CHART_DB_MANIFEST_FILE,
  chartDbDumpKey,
  fetchChartDbDump,
  parseChartDbManifest,
} from './lib/chorusChartDb/chartDbAssets';

/**
 * Builds the Chorus chart dump that seeds a first-time visitor's local
 * database. `scripts/uploadChartDb.ts` publishes what this writes.
 *
 *   pnpm update:db                    full crawl from the beginning of time
 *   pnpm update:db --incremental      fetch only what changed since the
 *                                     published dump, then merge into it
 *   pnpm update:db --fresh            ignore an interrupted run
 *
 * Incremental runs are what the daily schedule uses: a handful of requests
 * instead of ~400. They only ever add or replace charts, so charts deleted from
 * Chorus linger — the monthly full run is what clears those out.
 */

const OUT_DIR = path.join('.', 'public', 'data');
const CHART_FILE = path.join(OUT_DIR, 'charts.json');
const METADATA_FILE = path.join(OUT_DIR, 'metadata.json');
const RAW_FILE_LOCATION = path.join('.', 'raw_db_files');

const START_TIME = new Date('2011-01-01');

const SAVE_RAW_FILES = true;

const INCREMENTAL = process.argv.includes('--incremental');
// Pass --fresh to ignore an interrupted run, e.g. one that keeps failing for a
// reason retrying won't fix.
const FRESH = process.argv.includes('--fresh');

/**
 * The published dump an incremental run builds on, or null for a full crawl.
 * Reads the manifest from the local file written by the previous publish — the
 * CI commits `CHART_DB_MANIFEST_FILE` after each successful upload so it is
 * present in the checked-out repo on the next run.
 * Returns null rather than throwing when nothing is published yet, so the first
 * scheduled run bootstraps itself with a full crawl.
 */
async function loadBaseManifest(): Promise<ChartDbManifest | null> {
  if (!INCREMENTAL) {
    return null;
  }

  try {
    return parseChartDbManifest(
      JSON.parse(fs.readFileSync(CHART_DB_MANIFEST_FILE, 'utf8')),
    );
  } catch (error) {
    console.log(
      'No usable local manifest to build on, falling back to a full crawl:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function loadBaseCharts(version: string): Promise<any[]> {
  // The key is derived from the version rather than read from the current
  // manifest so a resumed run rebuilds the same base even if a newer dump was
  // published meanwhile. Dump keys are immutable, so this always resolves the
  // exact bytes the run started from.
  const charts = await fetchChartDbDump(chartDbDumpKey(version));
  console.log(`Loaded ${charts.length} charts from published dump ${version}`);
  return charts;
}

async function run() {
  const resumable =
    SAVE_RAW_FILES && !FRESH ? findResumableRun(RAW_FILE_LOCATION) : null;

  let runDir: string;
  let state: RunState;
  const seedCharts: any[] = [];

  if (resumable) {
    runDir = resumable.runDir;
    state = resumable.state;

    if (state.baseVersion != null) {
      seedCharts.push(...(await loadBaseCharts(state.baseVersion)));
    }
    const savedCharts = readSavedCharts(runDir, state.batchCount);
    seedCharts.push(...savedCharts);

    console.log(
      `Resuming ${runDir}: ${savedCharts.length} charts fetched since the run started, continuing after chart id ${state.lastChartId}`,
    );
  } else {
    const runStartTime = new Date();
    const baseManifest = await loadBaseManifest();

    if (baseManifest) {
      seedCharts.push(...(await loadBaseCharts(baseManifest.version)));
    }

    runDir = newRunDir(RAW_FILE_LOCATION, runStartTime);
    state = {
      // An incremental run only asks for what changed since the dump it builds
      // on. A full crawl asks for everything.
      afterTime: baseManifest?.lastRun ?? START_TIME.toISOString(),
      runStartTime: runStartTime.toISOString(),
      baseVersion: baseManifest?.version ?? null,
      lastChartId: 1,
      batchCount: 0,
      complete: false,
    };
  }

  console.log(
    state.baseVersion == null
      ? 'Running a full crawl'
      : `Running incrementally on top of ${state.baseVersion}, fetching charts modified after ${state.afterTime}`,
  );

  if (SAVE_RAW_FILES) {
    fs.mkdirSync(runDir, {recursive: true});
    writeRunState(runDir, state);
  }

  const {charts, metadata} = await fetchNewCharts(
    new Date(state.afterTime),
    state.lastChartId,
    (json, stats) => {
      if (!SAVE_RAW_FILES) {
        return;
      }
      state = saveBatch(runDir, state, json, stats.lastChartId);
    },
    {seedCharts, runStartTime: new Date(state.runStartTime)},
  );

  fs.mkdirSync(OUT_DIR, {recursive: true});
  fs.writeFileSync(CHART_FILE, JSON.stringify(charts));
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata));
  console.log(`Wrote ${charts.length} charts to ${CHART_FILE}`);

  if (SAVE_RAW_FILES) {
    writeRunState(runDir, {...state, complete: true});
  }
}

run().catch(error => {
  console.error(error);
  console.error(
    'Run failed. Re-run this script to resume from the last saved batch.',
  );
  process.exitCode = 1;
});
