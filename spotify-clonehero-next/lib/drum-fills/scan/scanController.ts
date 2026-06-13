/**
 * Main-thread orchestration for the library scan.
 *
 * Responsibilities:
 *   - obtain the Songs directory handle (cached, or signal the UI to pick one),
 *   - spawn the scan worker and relay progress,
 *   - persist detected fills to the local DB in per-song batches
 *     (`replaceFillsForSong`, keyed by chartHash so a rescan replaces cleanly),
 *   - bookkeep the scan run (`scan_runs`),
 *   - expose cancellation.
 *
 * DB writes stay on the main thread because SQLocal is per-tab.
 */

import {getCachedSongsDirectoryHandle} from '@/lib/local-songs-folder';
import {
  finishScanRun,
  replaceFillsForSong,
  startScanRun,
  type FillInput,
} from '@/lib/drum-fills/db';

import type {
  ScanProgress,
  ScanRequest,
  ScanResponse,
  ScannedFill,
} from './types';

export interface RunScanOptions {
  /** Progress callback, fired on the main thread as the worker reports. */
  onProgress?: (progress: ScanProgress) => void;
  /**
   * Provide a directory handle directly (e.g. the UI just ran the picker).
   * When omitted, the cached handle is used; if there is none, the scan rejects
   * with `NEEDS_PICKER` so the UI can prompt and retry.
   */
  directoryHandle?: FileSystemDirectoryHandle;
  /** Hook for tests / alternative bundlers to supply the worker. */
  createWorker?: () => Worker;
}

export interface ScanRunResult {
  cancelled: boolean;
  songsScanned: number;
  fillsFound: number;
  errors: number;
}

/** Thrown when no directory handle is available and the UI must run the picker. */
export const NEEDS_PICKER = 'NEEDS_PICKER';

/** A handle to an in-flight scan: await `done`, or `cancel()` to stop early. */
export interface ScanHandle {
  done: Promise<ScanRunResult>;
  cancel: () => void;
}

function defaultCreateWorker(): Worker {
  return new Worker(new URL('./scanWorker.ts', import.meta.url), {
    type: 'module',
  });
}

/** Map a worker-emitted fill to the DB insert shape. */
function toFillInput(fill: ScannedFill): FillInput {
  return {
    id: fill.id,
    chartHash: fill.chartHash,
    libraryPath: fill.libraryPath,
    song: fill.song,
    artist: fill.artist,
    charter: fill.charter,
    startTick: fill.startTick,
    endTick: fill.endTick,
    grooveStartTick: fill.grooveStartTick,
    grooveEndTick: fill.grooveEndTick,
    tempoBpm: fill.tempoBpm,
    lengthBars: fill.lengthBars,
    subdivision: fill.subdivision,
    complexity: fill.complexity,
    voicingTags: fill.voicingTags,
    difficultyScore: fill.difficultyScore,
    fingerprint: fill.fingerprint,
    grooveFingerprint: fill.grooveFingerprint,
    grooveSimilarityKey: fill.grooveSimilarityKey,
    fillSimilarityKey: fill.fillSimilarityKey,
    confidence: fill.confidence,
    features: fill.features as unknown as Record<string, unknown>,
  };
}

/**
 * Start a library scan. Resolves the directory handle, spawns the worker,
 * persists results, and returns a handle whose `done` promise settles when the
 * scan finishes (or is cancelled). Rejects `done` with `NEEDS_PICKER` if no
 * directory handle is available.
 */
export async function startLibraryScan(
  options: RunScanOptions = {},
): Promise<ScanHandle> {
  const handle =
    options.directoryHandle ?? (await getCachedSongsDirectoryHandle());
  if (!handle) {
    throw new Error(NEEDS_PICKER);
  }

  const createWorker = options.createWorker ?? defaultCreateWorker;
  const worker = createWorker();

  const scanRunId = await startScanRun();

  // Persist fills per-song. The worker emits fills in song order, so we buffer
  // by chartHash and flush a group once a different chartHash appears (or at
  // the end). This preserves `replaceFillsForSong`'s replace-per-song scope
  // even when a results batch straddles a song boundary.
  const pending = new Map<string, FillInput[]>();
  const writeQueue: Promise<void>[] = [];
  let lastChartHash: string | null = null;

  const flushChart = (chartHash: string) => {
    const fills = pending.get(chartHash);
    if (!fills) return;
    pending.delete(chartHash);
    writeQueue.push(
      replaceFillsForSong(chartHash, fills).catch(err => {
        console.error('Failed to persist fills for', chartHash, err);
      }),
    );
  };

  const ingest = (fills: ScannedFill[]) => {
    for (const fill of fills) {
      if (lastChartHash != null && fill.chartHash !== lastChartHash) {
        flushChart(lastChartHash);
      }
      lastChartHash = fill.chartHash;
      const list = pending.get(fill.chartHash) ?? [];
      list.push(toFillInput(fill));
      pending.set(fill.chartHash, list);
    }
  };

  let resolveDone!: (r: ScanRunResult) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<ScanRunResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const finalize = async (progress: ScanProgress, cancelled: boolean) => {
    // Flush any remaining buffered songs, then wait for all writes.
    for (const chartHash of pending.keys()) flushChart(chartHash);
    try {
      await Promise.all(writeQueue);
    } catch (err) {
      console.error('Error draining fill writes', err);
    }

    try {
      await finishScanRun(scanRunId, {
        songsScanned: progress.songsScanned,
        fillsFound: progress.fillsFound,
      });
    } catch (err) {
      console.error('Failed to finalize scan run', err);
    }

    worker.terminate();
    resolveDone({
      cancelled,
      songsScanned: progress.songsScanned,
      fillsFound: progress.fillsFound,
      errors: progress.errors,
    });
  };

  worker.onmessage = (event: MessageEvent<ScanResponse>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'progress':
        options.onProgress?.(msg.progress);
        break;
      case 'results':
        ingest(msg.fills);
        break;
      case 'done':
        options.onProgress?.(msg.progress);
        void finalize(msg.progress, msg.cancelled);
        break;
      case 'error':
        worker.terminate();
        rejectDone(new Error(msg.message));
        break;
    }
  };

  worker.onerror = event => {
    worker.terminate();
    rejectDone(new Error(event.message || 'Scan worker crashed'));
  };

  const startMsg: ScanRequest = {type: 'start', directoryHandle: handle};
  worker.postMessage(startMsg);

  const cancel = () => {
    const cancelMsg: ScanRequest = {type: 'cancel'};
    worker.postMessage(cancelMsg);
  };

  return {done, cancel};
}
