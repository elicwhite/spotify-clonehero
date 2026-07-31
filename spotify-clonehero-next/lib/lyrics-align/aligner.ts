/**
 * Browser-based vocal alignment engine (main-thread client).
 *
 * All heavy work (ONNX session creation, CTC inference, Viterbi) runs in
 * a dedicated Web Worker so the UI stays responsive.
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/aligner.ts
 */

import type {LyricLine} from '@/lib/karaoke/parse-lyrics';

export interface AlignedWord {
  text: string;
  startMs: number;
}

export interface InputSyllable {
  text: string;
  joinNext: boolean;
}

export interface AlignedSyllable {
  text: string;
  /** Viterbi onset of the syllable's first char (RMS-refined). */
  startMs: number;
  /** Viterbi END frame of the syllable's last char, in ms (no refinement). */
  endMs: number;
  joinNext: boolean;
  /** True if this syllable starts a new input lyrics line. */
  newLine: boolean;
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

export interface AlignProgressInfo {
  /** 0..1 progress within the current activity (model download, CTC), when
   *  the worker knows it. */
  percent?: number | undefined;
}

export type AlignProgressFn = (msg: string, info?: AlignProgressInfo) => void;

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Progress fan-out. The worker is a module singleton whose init may be
 * kicked off by one caller (a preload effect) and awaited by another (the
 * actual align) — a single persistent listener dispatching to whoever is
 * currently subscribed means progress reaches the UI that's showing it.
 */
const progressSubscribers = new Set<AlignProgressFn>();

/** Pending promise rejecters, so a dead worker fails callers instead of
 *  hanging them. */
const pendingFailures = new Set<(err: Error) => void>();

function subscribeProgress(fn?: AlignProgressFn): () => void {
  if (!fn) return () => {};
  progressSubscribers.add(fn);
  return () => progressSubscribers.delete(fn);
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./aligner-worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === 'progress') {
        for (const fn of progressSubscribers) {
          fn(msg.message, {percent: msg.percent});
        }
      }
    });
    // A worker whose script fails to load (or that dies with an uncaught
    // error) never posts anything — without this, every pending promise
    // would hang forever with no way to retry.
    worker.addEventListener('error', (e: ErrorEvent) => {
      const err = new Error(
        `Alignment worker failed: ${e.message || 'failed to load'}`,
      );
      worker?.terminate();
      worker = null;
      initPromise = null;
      const rejecters = [...pendingFailures];
      pendingFailures.clear();
      for (const reject of rejecters) reject(err);
    });
  }
  return worker;
}

/**
 * Download and cache the wav2vec2 model (does NOT create the ONNX session).
 * Safe to call multiple times — the download runs once, but every caller's
 * onProgress sees progress while it's subscribed. A failed init clears the
 * cached promise so a later call can retry without a page reload.
 */
export function init(onProgress?: AlignProgressFn): Promise<void> {
  const unsubscribe = subscribeProgress(onProgress);

  if (!initPromise) {
    initPromise = new Promise<void>((resolve, reject) => {
      const w = getWorker();

      const settle = () => {
        w.removeEventListener('message', handler);
        pendingFailures.delete(reject);
      };
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'initDone') {
          settle();
          resolve();
        } else if (msg.type === 'error') {
          settle();
          initPromise = null;
          reject(new Error(msg.message));
        }
      };

      pendingFailures.add(reject);
      w.addEventListener('message', handler);
      w.postMessage({type: 'init'});
    });
  }

  return initPromise.finally(unsubscribe);
}

/**
 * Align plain-text lyrics to pre-separated vocals (16 kHz mono).
 * Runs entirely in a worker — the main thread stays free.
 *
 * Lyrics are automatically syllabified using TeX hyphenation patterns.
 * Returns per-syllable timestamps (with joinNext markers) in addition to
 * word-level timestamps and karaoke display lines.
 */
export async function alignVocals(
  vocals16k: Float32Array,
  lyrics: string,
  onProgress?: AlignProgressFn,
): Promise<{
  lines: LyricLine[];
  words: AlignedWord[];
  syllables: AlignedSyllable[];
  durationMs: number;
  /** Fraction of syllables Viterbi was unconfident about (mean score < -3). */
  lowConfidenceFrac: number;
  /** True when `lowConfidenceFrac >= 0.75` — used internally to escalate
   *  to tier-2 Demucs retry. Not surfaced to the user. */
  lowConfidence: boolean;
}> {
  // Subscribe for the whole call so progress from a still-running model
  // download (kicked off by a preloading init()) is visible too.
  const unsubscribe = subscribeProgress(onProgress);
  try {
    // Ensure model is downloaded (no-op if already done)
    await init();

    return await new Promise((resolve, reject) => {
      const w = getWorker();

      const settle = () => {
        w.removeEventListener('message', handler);
        pendingFailures.delete(reject);
      };
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'result') {
          settle();
          resolve({
            lines: msg.lines,
            words: msg.words,
            syllables: msg.syllables,
            durationMs: msg.durationMs,
            lowConfidenceFrac: msg.lowConfidenceFrac,
            lowConfidence: msg.lowConfidence,
          });
        } else if (msg.type === 'error') {
          settle();
          reject(new Error(msg.message));
        }
      };

      pendingFailures.add(reject);
      w.addEventListener('message', handler);
      w.postMessage({type: 'align', vocals16k, lyrics}, [vocals16k.buffer]);
    });
  } finally {
    unsubscribe();
  }
}
