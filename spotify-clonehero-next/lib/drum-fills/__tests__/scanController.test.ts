/**
 * Controller tests: drive a fake worker and assert DB persistence grouping +
 * scan-run bookkeeping. The DB layer and handle cache are mocked.
 */

import type {ScannedFill, ScanProgress, ScanResponse} from '../scan/types';

const replaceFillsForSong = jest.fn().mockResolvedValue(undefined);
const startScanRun = jest.fn().mockResolvedValue(42);
const finishScanRun = jest.fn().mockResolvedValue(undefined);
const getCachedSongsDirectoryHandle = jest.fn();

jest.mock('../../local-db/drum-fills', () => ({
  replaceFillsForSong: (...args: unknown[]) => replaceFillsForSong(...args),
  startScanRun: (...args: unknown[]) => startScanRun(...args),
  finishScanRun: (...args: unknown[]) => finishScanRun(...args),
}));

jest.mock('../../local-songs-folder', () => ({
  getCachedSongsDirectoryHandle: (...args: unknown[]) =>
    getCachedSongsDirectoryHandle(...args),
}));

import {startLibraryScan, NEEDS_PICKER} from '../scan/scanController';

/** A controllable fake worker the controller talks to. */
class FakeWorker {
  onmessage: ((e: MessageEvent<ScanResponse>) => void) | null = null;
  onerror: ((e: {message: string}) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  // Simulate a worker → main message.
  emit(msg: ScanResponse) {
    this.onmessage?.({data: msg} as MessageEvent<ScanResponse>);
  }
}

function fill(id: string, chartHash: string): ScannedFill {
  return {
    id,
    chartHash,
    libraryPath: 'Songs/x',
    song: 's',
    artist: 'a',
    charter: 'c',
    startTick: 0,
    endTick: 100,
    grooveStartTick: 0,
    grooveEndTick: 0,
    tempoBpm: 120,
    lengthBars: 1,
    subdivision: '16ths',
    complexity: 3,
    voicingTags: ['toms'],
    difficultyScore: 50,
    fingerprint: 'fp',
    grooveFingerprint: 'gfp',
    grooveSimilarityKey: 'gsk',
    fillSimilarityKey: 'fsk',
    confidence: 0.8,
    features: {} as never,
  };
}

const PROGRESS = (over: Partial<ScanProgress> = {}): ScanProgress => ({
  songsScanned: 0,
  totalEstimate: 0,
  fillsFound: 0,
  currentSong: null,
  errors: 0,
  ...over,
});

const DUMMY_HANDLE = {name: 'Songs'} as unknown as FileSystemDirectoryHandle;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('startLibraryScan', () => {
  it('rejects with NEEDS_PICKER when no handle is available', async () => {
    getCachedSongsDirectoryHandle.mockResolvedValue(null);
    await expect(startLibraryScan()).rejects.toThrow(NEEDS_PICKER);
    expect(startScanRun).not.toHaveBeenCalled();
  });

  it('uses a supplied handle, starts a scan run, and posts start to the worker', async () => {
    const worker = new FakeWorker();
    await startLibraryScan({
      directoryHandle: DUMMY_HANDLE,
      createWorker: () => worker as unknown as Worker,
    });
    expect(startScanRun).toHaveBeenCalledTimes(1);
    expect(worker.posted[0]).toEqual({
      type: 'start',
      directoryHandle: DUMMY_HANDLE,
    });
  });

  it('persists fills grouped per chartHash, even across straddling batches', async () => {
    const worker = new FakeWorker();
    const handle = await startLibraryScan({
      directoryHandle: DUMMY_HANDLE,
      createWorker: () => worker as unknown as Worker,
    });

    // Batch 1 ends mid-song-B (B straddles the batch boundary).
    worker.emit({
      type: 'results',
      fills: [fill('a1', 'A'), fill('a2', 'A'), fill('b1', 'B')],
    });
    // Batch 2 continues song B then moves to C.
    worker.emit({
      type: 'results',
      fills: [fill('b2', 'B'), fill('c1', 'C')],
    });
    worker.emit({
      type: 'done',
      cancelled: false,
      progress: PROGRESS({songsScanned: 3, fillsFound: 5}),
    });

    const result = await handle.done;

    // A flushed when B appeared; B flushed when C appeared; C flushed at done.
    expect(replaceFillsForSong).toHaveBeenCalledTimes(3);
    const calls = replaceFillsForSong.mock.calls;
    const byHash = new Map(calls.map(c => [c[0], c[1].map((f: any) => f.id)]));
    expect(byHash.get('A')).toEqual(['a1', 'a2']);
    expect(byHash.get('B')).toEqual(['b1', 'b2']);
    expect(byHash.get('C')).toEqual(['c1']);

    expect(finishScanRun).toHaveBeenCalledWith(42, {
      songsScanned: 3,
      fillsFound: 5,
    });
    expect(result).toEqual({
      cancelled: false,
      songsScanned: 3,
      fillsFound: 5,
      errors: 0,
    });
    expect(worker.terminated).toBe(true);
  });

  it('relays progress to the callback', async () => {
    const worker = new FakeWorker();
    const onProgress = jest.fn();
    await startLibraryScan({
      directoryHandle: DUMMY_HANDLE,
      createWorker: () => worker as unknown as Worker,
      onProgress,
    });
    const p = PROGRESS({songsScanned: 5, totalEstimate: 10, fillsFound: 2});
    worker.emit({type: 'progress', progress: p});
    expect(onProgress).toHaveBeenCalledWith(p);
  });

  it('forwards cancellation to the worker', async () => {
    const worker = new FakeWorker();
    const handle = await startLibraryScan({
      directoryHandle: DUMMY_HANDLE,
      createWorker: () => worker as unknown as Worker,
    });
    handle.cancel();
    expect(worker.posted).toContainEqual({type: 'cancel'});

    worker.emit({
      type: 'done',
      cancelled: true,
      progress: PROGRESS({songsScanned: 1}),
    });
    const result = await handle.done;
    expect(result.cancelled).toBe(true);
  });

  it('rejects done on a worker error', async () => {
    const worker = new FakeWorker();
    const handle = await startLibraryScan({
      directoryHandle: DUMMY_HANDLE,
      createWorker: () => worker as unknown as Worker,
    });
    worker.emit({type: 'error', message: 'boom'});
    await expect(handle.done).rejects.toThrow('boom');
    expect(worker.terminated).toBe(true);
  });
});
