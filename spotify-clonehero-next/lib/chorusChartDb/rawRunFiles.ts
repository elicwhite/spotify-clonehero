import path from 'path';
import fs from 'fs';
import type {ChorusChartDbRow} from './types';

/**
 * On-disk bookkeeping for `downloadDb.ts`. Each run owns a directory holding
 * one JSON file per API response plus a state file, so a run that dies partway
 * through can be resumed instead of restarted.
 *
 * An unfinished run directory means "continue this", unconditionally. There is
 * no flag for ignoring one: delete the directory to start over. A resumed run
 * that no longer makes sense — its base dump is gone, a batch file is corrupt —
 * throws rather than quietly degrading into a different run than the one on
 * disk.
 */

export const STATE_FILE_NAME = 'state.json';
export const RUN_DIR_PREFIX = 'run-';
const BATCH_FILE_PATTERN = /^(\d{5})-\d+\.json$/;

function batchNumber(fileName: string): number | null {
  const match = BATCH_FILE_PATTERN.exec(fileName);
  return match ? Number(match[1]) : null;
}

export type RunState = {
  /** `modifiedAfter` the run started from. Kept stable across resumes. */
  afterTime: string;
  /** When the run first started, so `metadata.lastRun` survives a resume. */
  runStartTime: string;
  /**
   * The published dump this run merges into, or null for a full crawl. A
   * resumed run re-downloads it — the batch files hold only what this run
   * fetched, not the base it was merging into — so the checksum travels with
   * the version rather than beside it, and a version without one is
   * unrepresentable.
   */
  base: {version: string; contentSha256: string} | null;
  /** Highest chart id whose response has been written to disk. */
  lastChartId: number;
  /** How many batch files are known-good. Anything past this is a torn write. */
  batchCount: number;
  complete: boolean;
};

export function readRunState(runDir: string): RunState | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(runDir, STATE_FILE_NAME), 'utf8'),
    ) as RunState;
  } catch {
    return null;
  }
}

export function writeRunState(runDir: string, state: RunState) {
  // Written through a temp file so a crash mid-write can't leave an
  // unparseable state file, which would strand the whole run's work.
  const statePath = path.join(runDir, STATE_FILE_NAME);
  const tempPath = `${statePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2));
  fs.renameSync(tempPath, statePath);
}

/** The newest run directory that was interrupted before it finished. */
export function findResumableRun(
  rawFileLocation: string,
): {runDir: string; state: RunState} | null {
  if (!fs.existsSync(rawFileLocation)) {
    return null;
  }

  const runDirs = fs
    .readdirSync(rawFileLocation, {withFileTypes: true})
    .filter(
      entry => entry.isDirectory() && entry.name.startsWith(RUN_DIR_PREFIX),
    )
    .map(entry => entry.name)
    .sort()
    .reverse();

  for (const name of runDirs) {
    const runDir = path.join(rawFileLocation, name);
    const state = readRunState(runDir);
    if (state != null && !state.complete) {
      return {runDir, state};
    }
  }

  return null;
}

export function newRunDir(rawFileLocation: string, runStartTime: Date): string {
  return path.join(
    rawFileLocation,
    RUN_DIR_PREFIX + runStartTime.toISOString().replace(/[:.]/g, '-'),
  );
}

/**
 * Charts from every batch file the state file vouches for. Selection is by the
 * batch number in the file name, not by position, so an orphaned file left by
 * a torn write can never displace a real batch.
 */
export function readSavedCharts(
  runDir: string,
  batchCount: number,
): ChorusChartDbRow[] {
  const batchFiles = fs
    .readdirSync(runDir)
    .map(name => ({name, batch: batchNumber(name)}))
    .filter(
      (entry): entry is {name: string; batch: number} =>
        entry.batch != null && entry.batch >= 1 && entry.batch <= batchCount,
    )
    .sort((a, b) => a.batch - b.batch);

  if (batchFiles.length !== batchCount) {
    throw new Error(
      `Expected ${batchCount} batch files in ${runDir} but found ${batchFiles.length}. Refusing to resume from an incomplete run directory.`,
    );
  }

  const charts: ChorusChartDbRow[] = [];
  for (const {name} of batchFiles) {
    const json: unknown = JSON.parse(
      fs.readFileSync(path.join(runDir, name), 'utf8'),
    );
    if (!Array.isArray(json)) {
      throw new Error(`Saved batch ${name} is not an array`);
    }
    // This process wrote these rows minutes ago, already narrowed. A torn
    // write is caught by JSON.parse and by batchCount, not by re-checking
    // every field of our own output.
    charts.push(...(json as ChorusChartDbRow[]));
  }

  return charts;
}

/**
 * Writes one response to disk and then records it in the state file. The order
 * matters: a crash between the two leaves a batch file the resume ignores,
 * which is safe, whereas the reverse would silently drop charts.
 */
export function saveBatch(
  runDir: string,
  state: RunState,
  charts: ChorusChartDbRow[],
  lastChartId: number,
): RunState {
  const batch = state.batchCount + 1;

  // A previous attempt may have written this batch with a different chart id
  // in its name before dying. Clear it so a batch number never maps to two
  // files.
  for (const name of fs.readdirSync(runDir)) {
    if (batchNumber(name) === batch) {
      fs.rmSync(path.join(runDir, name));
    }
  }

  const batchName = `${String(batch).padStart(5, '0')}-${lastChartId}.json`;
  fs.writeFileSync(
    path.join(runDir, batchName),
    JSON.stringify(charts, null, 2),
  );

  const nextState: RunState = {
    ...state,
    lastChartId,
    batchCount: state.batchCount + 1,
  };
  writeRunState(runDir, nextState);
  return nextState;
}
