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
  CHART_DB_DATA_VERSION,
  ChartDbManifest,
  chartDbDumpKey,
  fetchChartDbDump,
  fetchChartDbManifest,
} from './lib/chorusChartDb/chartDbAssets';
import type {ChorusChartDbRow} from './lib/chorusChartDb/types';

/**
 * Builds the Chorus chart dump that seeds a first-time visitor's local
 * database. `scripts/uploadChartDb.ts` publishes what this writes.
 *
 *   pnpm update:db                    full crawl from the beginning of time
 *   pnpm update:db --incremental      fetch only what changed since the
 *                                     published dump, then merge into it
 *
 * Incremental runs are what the daily schedule uses: a handful of requests
 * instead of ~400. They only ever add or replace charts, so charts deleted from
 * Chorus linger — the monthly full run is what clears those out.
 *
 * An unfinished run directory under `raw_db_files/` is always resumed, and the
 * resumed run keeps its own cutoff and base regardless of the flags passed this
 * time. To start over, delete the directory.
 */

const OUT_DIR = path.join('.', 'public', 'data');
const CHART_FILE = path.join(OUT_DIR, 'charts.json');
const METADATA_FILE = path.join(OUT_DIR, 'metadata.json');
const RAW_FILE_LOCATION = path.join('.', 'raw_db_files');

const START_TIME = new Date('2011-01-01');

const SAVE_RAW_FILES = true;

const INCREMENTAL = process.argv.includes('--incremental');

/**
 * The published dump an incremental run builds on, or null for a full crawl.
 * Returns null rather than throwing when nothing is published yet, so the first
 * scheduled run bootstraps itself with a full crawl.
 */
async function loadBaseManifest(): Promise<ChartDbManifest | null> {
  if (!INCREMENTAL) {
    return null;
  }

  try {
    const manifest = await fetchChartDbManifest();
    if (manifest.dataVersion !== CHART_DB_DATA_VERSION) {
      throw new Error(
        `Published dump is data version ${manifest.dataVersion}; expected ${CHART_DB_DATA_VERSION}`,
      );
    }
    return manifest;
  } catch (error) {
    if (error instanceof Error && error.message.includes('status 404')) {
      console.log('No published dump found; falling back to a full crawl');
      return null;
    }
    throw error;
  }
}

async function loadBaseCharts(
  base: NonNullable<RunState['base']>,
): Promise<ChorusChartDbRow[]> {
  // The key is derived from the version rather than read from the current
  // manifest so a resumed run rebuilds the same base even if a newer dump was
  // published meanwhile. Dump keys are immutable, so this always resolves the
  // exact bytes the run started from.
  const charts = await fetchChartDbDump(
    chartDbDumpKey(base.version),
    fetch,
    base.contentSha256,
  );
  console.log(
    `Loaded ${charts.length} charts from published dump ${base.version}`,
  );
  return charts;
}

async function run() {
  const resumable = SAVE_RAW_FILES ? findResumableRun(RAW_FILE_LOCATION) : null;

  let runDir: string;
  let state: RunState;

  if (resumable) {
    // The run on disk decides what this is. Flags passed now are ignored:
    // resuming a crawl as something other than what it started as would
    // silently produce a dump with a hole in it.
    ({runDir, state} = resumable);
    console.log(
      `Resuming ${runDir} after chart id ${state.lastChartId}. ` +
        'Delete that directory to start over.',
    );
  } else {
    const runStartTime = new Date();
    const baseManifest = await loadBaseManifest();

    runDir = newRunDir(RAW_FILE_LOCATION, runStartTime);
    state = {
      // An incremental run only asks for what changed since the dump it builds
      // on. A full crawl asks for everything.
      afterTime: baseManifest?.lastRun ?? START_TIME.toISOString(),
      runStartTime: runStartTime.toISOString(),
      base: baseManifest && {
        version: baseManifest.version,
        contentSha256: baseManifest.contentSha256,
      },
      lastChartId: 1,
      batchCount: 0,
      complete: false,
    };
  }

  const seedCharts: ChorusChartDbRow[] = state.base
    ? await loadBaseCharts(state.base)
    : [];
  if (resumable) {
    const savedCharts = readSavedCharts(runDir, state.batchCount);
    seedCharts.push(...savedCharts);
    console.log(`${savedCharts.length} charts already fetched by this run`);
  }

  console.log(
    state.base == null
      ? 'Running a full crawl'
      : `Running incrementally on top of ${state.base.version}, fetching charts modified after ${state.afterTime}`,
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
