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
  startMs: number;
  joinNext: boolean;
  /** True if this syllable starts a new input lyrics line. */
  newLine: boolean;
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./aligner-worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return worker;
}

/**
 * Download and cache the wav2vec2 model (does NOT create the ONNX session).
 * Safe to call multiple times — only runs once.
 */
export function init(onProgress?: (msg: string) => void): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = new Promise<void>((resolve, reject) => {
    const w = getWorker();

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.message);
      } else if (msg.type === 'initDone') {
        w.removeEventListener('message', handler);
        resolve();
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.message));
      }
    };

    w.addEventListener('message', handler);
    w.postMessage({type: 'init'});
  });

  return initPromise;
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
  onProgress?: (msg: string) => void,
): Promise<{
  lines: LyricLine[];
  words: AlignedWord[];
  syllables: AlignedSyllable[];
  durationMs: number;
}> {
  // Ensure model is downloaded (no-op if already done)
  await init(onProgress);

  return new Promise((resolve, reject) => {
    const w = getWorker();

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.message);
      } else if (msg.type === 'result') {
        w.removeEventListener('message', handler);
        resolve({
          lines: msg.lines,
          words: msg.words,
          syllables: msg.syllables,
          durationMs: msg.durationMs,
        });
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.message));
      }
    };

    w.addEventListener('message', handler);
    w.postMessage({type: 'align', vocals16k, lyrics}, [vocals16k.buffer]);
  });
}
