/**
 * Main-thread client for the difficulty-generation worker (plan 0074
 * Design D). Spawns a one-shot worker, runs one instrument's reduction, then
 * terminates the worker. Cancellation follows the shared one-shot-worker
 * convention (`lib/workers/abortable-worker.ts`, `runAbortableWorker`): a
 * pre-aborted signal rejects before any worker is spawned, aborting mid-run
 * terminates the worker and rejects with an AbortError, and the abort
 * listener is removed however the run settles.
 *
 * ---------------------------------------------------------------------------
 * BASS SPOT-CHECK GATE — resolved (owner-validated 2026-08-03)
 * ---------------------------------------------------------------------------
 *
 * The plan's spot-check gate ("Bass reuse of the guitar reducer is an
 * experiment, not a decision") could not be run in this environment for lack
 * of a fixture chart with a bass track. The owner has since validated the
 * guitar reducer against real bass tracks directly ("I have validated that
 * the guitar lower difficulty generation algorithms work great for Bass
 * too.", live review 2026-08-03), which is the spot check the gate called
 * for. Bass generates through the identical guitar reducer path, so every
 * member of `DifficultyInstrument` is supported and this client has no
 * instrument gate at all. The UI's only standing reason for a disabled
 * affordance is "no assist runner wired in" (`useDifficultyGeneration`).
 */

import {
  makeAbortError,
  runAbortableWorker,
} from '@/lib/workers/abortable-worker';
import type {OursSongInput} from '@/lib/drum-difficulty/ours/featurize';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import type {Track} from '@/lib/preview/highway/types';
import type {
  DifficultyTiers,
  DifficultyWorkerMessage,
  DifficultyWorkerRequest,
} from './difficulty-protocol';

export interface DifficultyGenerationProgress {
  /** 0..1. */
  percent: number;
  detail?: string | undefined;
}

/** The payload each instrument's reducer needs, mirroring their own input
 * shapes: drums take the already-featurizer-ready
 * {@link OursSongInput} (built via `buildOursInput` from a `RawDrumChart` +
 * `ParsedChart` at the call site);
 * guitar/bass take a `ParsedChart` plus the single Expert track being
 * reduced, same as `reduceGuitarDifficulties`'s own signature. The reducer
 * reads only timing (`resolution`, `tempos`, `timeSignatures`, `sections`)
 * off that chart, and `buildDifficultyGenerationInput` passes one with an
 * empty `trackData` so the request that crosses `postMessage` doesn't clone
 * every other instrument's notes. */
export type DifficultyGenerationInput =
  | {instrument: 'drums'; input: OursSongInput}
  | {instrument: 'guitar' | 'bass'; chart: ParsedChart; expertTrack: Track};

export interface RunDifficultyGenerationOptions {
  /** Injectable worker factory (defaults to the real difficulty-worker.ts),
   * for tests to substitute a fake Worker. */
  createWorker?: (() => Worker) | undefined;
  signal?: AbortSignal | undefined;
}

export function defaultCreateWorker(): Worker {
  return new Worker(new URL('./difficulty-worker.ts', import.meta.url), {
    type: 'module',
  });
}

/** Runs one instrument's difficulty-tier generation to completion, following
 * the shared cancellable one-shot-worker contract. */
export async function runDifficultyGeneration(
  input: DifficultyGenerationInput,
  options: RunDifficultyGenerationOptions = {},
  onProgress?: (progress: DifficultyGenerationProgress) => void,
): Promise<{tiers: DifficultyTiers}> {
  if (options.signal?.aborted) {
    throw makeAbortError();
  }

  const createWorker = options.createWorker ?? defaultCreateWorker;
  const request: DifficultyWorkerRequest =
    input.instrument === 'drums'
      ? {type: 'run', instrument: 'drums', input: input.input}
      : {
          type: 'run',
          instrument: input.instrument,
          chart: input.chart,
          expertTrack: input.expertTrack,
        };

  const tiers = await runAbortableWorker<DifficultyTiers>(
    createWorker,
    options.signal,
    (worker, settle) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as DifficultyWorkerMessage;
        if (msg.type === 'progress') {
          onProgress?.({percent: msg.percent, detail: msg.detail});
        } else if (msg.type === 'result') {
          settle.resolve(msg.tiers);
        } else if (msg.type === 'error') {
          settle.reject(new Error(msg.message));
        }
      };
      worker.onerror = e => {
        settle.reject(
          new Error(e.message || 'Difficulty generation worker error'),
        );
      };
      worker.postMessage(request);
    },
  );

  return {tiers};
}
