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

const CHART_FILE = path.join('.', 'public', 'data', 'charts.json');
const METADATA_FILE = path.join('.', 'public', 'data', 'metadata.json');
const RAW_FILE_LOCATION = path.join('.', 'raw_db_files');

const START_TIME = new Date('2011-01-01');

const SAVE_RAW_FILES = true;

// Pass --fresh to ignore an interrupted run, e.g. one that keeps failing for a
// reason retrying won't fix.
const FRESH = process.argv.includes('--fresh');

async function run() {
  const resumable =
    SAVE_RAW_FILES && !FRESH ? findResumableRun(RAW_FILE_LOCATION) : null;

  let runDir: string;
  let state: RunState;
  let seedCharts: any[] = [];

  if (resumable) {
    runDir = resumable.runDir;
    state = resumable.state;
    seedCharts = readSavedCharts(runDir, state.batchCount);
    console.log(
      `Resuming ${runDir}: ${seedCharts.length} charts already fetched, continuing after chart id ${state.lastChartId}`,
    );
  } else {
    const runStartTime = new Date();
    runDir = newRunDir(RAW_FILE_LOCATION, runStartTime);
    state = {
      afterTime: START_TIME.toISOString(),
      runStartTime: runStartTime.toISOString(),
      lastChartId: 1,
      batchCount: 0,
      complete: false,
    };
  }

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

  fs.writeFileSync(CHART_FILE, JSON.stringify(charts));
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata));

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
