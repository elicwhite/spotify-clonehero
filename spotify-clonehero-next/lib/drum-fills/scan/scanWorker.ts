/**
 * Library-scan web worker.
 *
 * Receives a `FileSystemDirectoryHandle`, walks the Clone Hero library (reusing
 * `scanLocalCharts`), reads + parses each chart (reusing `chart-file-readers`
 * and `parseChartAndIni`), runs Expert-drums fill detection, and streams
 * progress + batched results back to the main thread.
 *
 * All heavy work (FS reads, chart parsing, detection) happens here, off the main
 * thread. The controller (`scanController.ts`) owns the DB writes, since SQLocal
 * is per-tab and lives on the main thread.
 *
 * Protocol (see ./types.ts):
 *   Main → Worker:  { type: 'start', directoryHandle } | { type: 'cancel' }
 *   Worker → Main:  progress | results | done | error
 */

import {parseChartAndIni} from '@eliwhite/scan-chart';
import type {File as ChartFile} from '@eliwhite/scan-chart';

import scanLocalCharts, {
  type SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {
  readChartDirectory,
  readSngFile,
} from '@/components/chart-picker/chart-file-readers';

import {detectFillsForChart} from './detectForChart';
import type {
  ScanProgress,
  ScanRequest,
  ScanResponse,
  ScannedFill,
} from './types';

// How many fills to buffer before flushing a results batch to the main thread.
const RESULTS_BATCH_SIZE = 100;
// How often (in songs) to emit a progress update.
const PROGRESS_EVERY = 5;
// Only chart/ini files are needed for detection — skip audio/art to save IO.
const WANTED_FILES = new Set(['notes.chart', 'notes.mid', 'song.ini']);

let cancelled = false;

function post(message: ScanResponse): void {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = (event: MessageEvent<ScanRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type === 'start') {
    cancelled = false;
    runScan(msg.directoryHandle).catch(err => {
      post({type: 'error', message: errorMessage(err)});
    });
  }
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function runScan(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<void> {
  // Phase 1: enumerate songs (cheap: only reads song.ini / .sng headers).
  const songs: SongAccumulator[] = [];
  try {
    await scanLocalCharts(directoryHandle, songs, () => {});
  } catch (err) {
    post({type: 'error', message: errorMessage(err)});
    return;
  }

  const progress: ScanProgress = {
    songsScanned: 0,
    totalEstimate: songs.length,
    fillsFound: 0,
    currentSong: null,
    errors: 0,
  };

  if (cancelled) {
    post({type: 'done', cancelled: true, progress});
    return;
  }

  // Phase 2: parse + detect each song. Sequential keeps memory bounded (charts
  // can be large) and detection is CPU-bound anyway.
  let batch: ScannedFill[] = [];

  const flush = () => {
    if (batch.length > 0) {
      post({type: 'results', fills: batch});
      batch = [];
    }
  };

  for (let i = 0; i < songs.length; i++) {
    if (cancelled) break;

    const song = songs[i];
    progress.currentSong = `${song.artist} - ${song.song}`;

    try {
      const fills = await processSong(song);
      progress.fillsFound += fills.length;
      batch.push(...fills);
      if (batch.length >= RESULTS_BATCH_SIZE) flush();
    } catch {
      // Per-song failure: skip + count, never abort the whole scan.
      progress.errors++;
    }

    progress.songsScanned = i + 1;
    if (progress.songsScanned % PROGRESS_EVERY === 0) {
      post({type: 'progress', progress: {...progress}});
    }
  }

  flush();
  post({
    type: 'done',
    cancelled,
    progress: {...progress, currentSong: null},
  });
}

/** Read, parse, and detect fills for a single enumerated song. */
async function processSong(song: SongAccumulator): Promise<ScannedFill[]> {
  const files = await readSongChartFiles(song);
  if (files.length === 0) return [];

  const parsed = parseChartAndIni(files).parsedChart;
  if (!parsed) return [];

  const libraryPath = `${song.handleInfo.parentDir.name}/${song.handleInfo.fileName}`;
  return detectFillsForChart(parsed, {
    libraryPath,
    song: song.song,
    artist: song.artist,
    charter: song.charter,
  });
}

/**
 * Resolve a song's handle from its `handleInfo` and read only the chart/ini
 * files needed for detection. Folder charts and .sng files are handled by the
 * shared `chart-file-readers` helpers.
 */
async function readSongChartFiles(song: SongAccumulator): Promise<ChartFile[]> {
  const {parentDir, fileName} = song.handleInfo;

  if (fileName.toLowerCase().endsWith('.sng')) {
    const fileHandle = await parentDir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const loaded = await readSngFile(file);
    return loaded.files.filter(f => WANTED_FILES.has(f.fileName.toLowerCase()));
  }

  const dirHandle = await parentDir.getDirectoryHandle(fileName);
  const loaded = await readChartDirectory(dirHandle);
  return loaded.files.filter(f => WANTED_FILES.has(f.fileName.toLowerCase()));
}
