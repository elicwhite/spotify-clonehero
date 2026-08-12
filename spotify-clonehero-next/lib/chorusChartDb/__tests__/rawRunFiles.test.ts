import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  findResumableRun,
  newRunDir,
  readSavedCharts,
  RunState,
  saveBatch,
  STATE_FILE_NAME,
  writeRunState,
} from '../rawRunFiles';

function makeState(overrides: Partial<RunState> = {}): RunState {
  return {
    afterTime: '2011-01-01T00:00:00.000Z',
    runStartTime: '2026-01-01T00:00:00.000Z',
    baseVersion: null,
    lastChartId: 1,
    batchCount: 0,
    complete: false,
    ...overrides,
  };
}

describe('rawRunFiles', () => {
  let rawDir: string;

  beforeEach(() => {
    rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-db-files-'));
  });

  afterEach(() => {
    fs.rmSync(rawDir, {recursive: true, force: true});
  });

  function makeRun(name: string, state: RunState) {
    const runDir = path.join(rawDir, name);
    fs.mkdirSync(runDir, {recursive: true});
    writeRunState(runDir, state);
    return runDir;
  }

  it('finds nothing when the raw file directory does not exist', () => {
    expect(findResumableRun(path.join(rawDir, 'missing'))).toBeNull();
  });

  it('finds nothing when every run completed', () => {
    makeRun('run-2026-01-01', makeState({complete: true}));
    makeRun('run-2026-01-02', makeState({complete: true}));

    expect(findResumableRun(rawDir)).toBeNull();
  });

  it('resumes the newest incomplete run', () => {
    makeRun('run-2026-01-01', makeState({lastChartId: 10}));
    makeRun('run-2026-01-03', makeState({lastChartId: 30}));
    makeRun('run-2026-01-02', makeState({lastChartId: 20, complete: true}));

    const resumable = findResumableRun(rawDir);

    expect(resumable?.runDir).toBe(path.join(rawDir, 'run-2026-01-03'));
    expect(resumable?.state.lastChartId).toBe(30);
  });

  it('ignores directories without a readable state file', () => {
    fs.mkdirSync(path.join(rawDir, 'run-2026-01-05'));
    fs.writeFileSync(
      path.join(rawDir, 'run-2026-01-05', STATE_FILE_NAME),
      'not json',
    );
    makeRun('run-2026-01-04', makeState({lastChartId: 40}));

    expect(findResumableRun(rawDir)?.runDir).toBe(
      path.join(rawDir, 'run-2026-01-04'),
    );
  });

  it('saves batches and reads them back in order', () => {
    const runDir = makeRun('run-2026-01-01', makeState());
    let state = makeState();

    state = saveBatch(runDir, state, [{groupId: 1}], 100);
    state = saveBatch(runDir, state, [{groupId: 2}], 250);

    expect(state.batchCount).toBe(2);
    expect(state.lastChartId).toBe(250);
    expect(readSavedCharts(runDir, state.batchCount)).toEqual([
      {groupId: 1},
      {groupId: 2},
    ]);
    expect(findResumableRun(rawDir)?.state.lastChartId).toBe(250);
  });

  it('sorts batches numerically past nine files', () => {
    const runDir = makeRun('run-2026-01-01', makeState());
    let state = makeState();

    for (let i = 1; i <= 11; i++) {
      state = saveBatch(runDir, state, [{groupId: i}], i * 10);
    }

    expect(
      readSavedCharts(runDir, state.batchCount).map(c => c.groupId),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('ignores a batch file written after the last state update', () => {
    const runDir = makeRun('run-2026-01-01', makeState());
    let state = makeState();
    state = saveBatch(runDir, state, [{groupId: 1}], 100);

    // A crash between writing the batch and updating the state file.
    fs.writeFileSync(
      path.join(runDir, '00002-250.json'),
      JSON.stringify([{groupId: 2}]),
    );

    expect(readSavedCharts(runDir, state.batchCount)).toEqual([{groupId: 1}]);
  });

  it('replaces an orphan batch whose retry lands on a different chart id', () => {
    const runDir = makeRun('run-2026-01-01', makeState());
    let state = makeState();
    state = saveBatch(runDir, state, [{groupId: 1}], 100);

    // Batch 2 hit the disk, then the run died before the state file agreed.
    fs.writeFileSync(
      path.join(runDir, '00002-500.json'),
      JSON.stringify([{groupId: 'orphan'}]),
    );

    // The resumed run refetches batch 2; a chart was deleted upstream, so the
    // page's highest chart id differs from the orphan's.
    state = saveBatch(runDir, state, [{groupId: 2}], 498);
    state = saveBatch(runDir, state, [{groupId: 3}], 700);

    expect(
      readSavedCharts(runDir, state.batchCount).map(c => c.groupId),
    ).toEqual([1, 2, 3]);
  });

  it('refuses to resume when a vouched-for batch file is missing', () => {
    const runDir = makeRun('run-2026-01-01', makeState());
    let state = makeState();
    state = saveBatch(runDir, state, [{groupId: 1}], 100);
    state = saveBatch(runDir, state, [{groupId: 2}], 200);
    fs.rmSync(path.join(runDir, '00001-100.json'));

    expect(() => readSavedCharts(runDir, state.batchCount)).toThrow(
      'Refusing to resume',
    );
  });

  it('leaves no temp file behind when writing state', () => {
    const runDir = makeRun('run-2026-01-01', makeState());

    expect(fs.readdirSync(runDir)).toEqual([STATE_FILE_NAME]);
  });

  it('names run directories so they sort chronologically', () => {
    const first = newRunDir(rawDir, new Date('2026-01-01T00:00:00.000Z'));
    const second = newRunDir(rawDir, new Date('2026-01-02T00:00:00.000Z'));

    expect(path.basename(first) < path.basename(second)).toBe(true);
    expect(path.basename(first)).toBe('run-2026-01-01T00-00-00-000Z');
  });
});
