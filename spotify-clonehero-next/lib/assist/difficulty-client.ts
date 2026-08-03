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
 * BASS SPOT-CHECK GATE (plan 0074 Design D risk item — "Bass reuse of the
 * guitar reducer is an experiment, not a decision")
 * ---------------------------------------------------------------------------
 *
 * The plan calls for spot-checking the guitar ONNX reducer against 2-3 real
 * bass tracks from `lib/drum-difficulty/__fixtures__` (or other available
 * fixture charts with bass parts) before wiring bass through. That check
 * could not be run: every fixture chart in this repo was searched —
 * `lib/drum-difficulty/__fixtures__/reduction-{01..20}/notes.mid` (all 20),
 * `lib/guitar-difficulty`'s own test fixtures, and every other `.mid`/
 * `.chart` file in the tree — and none contains a bass track (all 20
 * reduction fixtures are drums-only MIDI; none has a `PART BASS` track).
 * There is no other in-repo chart with a bass part, and this environment's
 * network sandbox does not permit fetching a real chart from an external
 * source to manufacture one (and fabricating a synthetic "bass" track from
 * unrelated note data would not be a real spot check — it would just assert
 * the code runs, not that the guitar reducer produces musically sane bass
 * output).
 *
 * Given the gate's own instruction for exactly this situation ("if quality is
 * unacceptable, bass generation ships disabled with a tooltip"), the
 * conservative reading applies equally to "quality could not be assessed":
 * bass ships DISABLED here. {@link GENERATION_DISABLED_INSTRUMENTS} is the
 * ONE place that says so — `runDifficultyGeneration` rejects such a request
 * with {@link UnsupportedInstrumentError} synchronously before any worker is
 * spawned, and the UI asks {@link difficultyGenerationDisabledReason} for the
 * text on its disabled affordance. Re-enabling bass once a real spot check is
 * possible is a matter of emptying that set and widening the worker request
 * union in `difficulty-protocol.ts`, not redesigning the pipeline.
 */

import {
  makeAbortError,
  runAbortableWorker,
} from '@/lib/workers/abortable-worker';
import type {OursSongInput} from '@/lib/drum-difficulty/ours/featurize';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import type {Track} from '@/lib/preview/highway/types';
import type {
  DifficultyInstrument,
  DifficultyTiers,
  DifficultyWorkerMessage,
  DifficultyWorkerRequest,
} from './difficulty-protocol';

/** The instruments this build refuses to generate difficulties for. See the
 * bass spot-check gate above. */
const GENERATION_DISABLED_INSTRUMENTS = new Set<DifficultyInstrument>(['bass']);

function unsupportedInstrumentMessage(instrument: string): string {
  return `Difficulty generation is not available for ${instrument} yet (unvalidated guitar-reducer reuse).`;
}

/** Thrown synchronously (no worker spawned) for an instrument this client
 * does not yet generate difficulties for. See the bass spot-check gate above
 * for why bass is currently in this state. */
export class UnsupportedInstrumentError extends Error {
  readonly instrument: string;

  constructor(instrument: string) {
    super(unsupportedInstrumentMessage(instrument));
    this.name = 'UnsupportedInstrumentError';
    this.instrument = instrument;
  }
}

/** Why this build won't generate difficulties for `instrument` at all (a
 * standing limit, not a property of any chart), or undefined when it will.
 * The UI renders this on its disabled affordance; a caller that ignores it
 * and starts a run anyway gets the identical text back as an
 * {@link UnsupportedInstrumentError}. */
export function difficultyGenerationDisabledReason(
  instrument: DifficultyInstrument,
): string | undefined {
  return GENERATION_DISABLED_INSTRUMENTS.has(instrument)
    ? unsupportedInstrumentMessage(instrument)
    : undefined;
}

export interface DifficultyGenerationProgress {
  /** 0..1. */
  percent: number;
  detail?: string | undefined;
}

/** The payload each instrument's reducer needs, mirroring
 * `lib/drum-difficulty/computeReductions` and `lib/guitar-difficulty/reduce`'s
 * own input shapes: drums take the already-featurizer-ready
 * {@link OursSongInput} (built via `buildOursInput` from a `RawDrumChart` +
 * `ParsedChart` at the call site, same as `/difficulties`' `runOurs`);
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

/** Runs one instrument's difficulty-tier generation to completion. Rejects
 * with {@link UnsupportedInstrumentError} for an instrument
 * {@link difficultyGenerationDisabledReason} names, before spawning a worker
 * (see the gate above); otherwise follows the shared cancellable
 * one-shot-worker contract. */
export async function runDifficultyGeneration(
  input: DifficultyGenerationInput,
  options: RunDifficultyGenerationOptions = {},
  onProgress?: (progress: DifficultyGenerationProgress) => void,
): Promise<{tiers: DifficultyTiers}> {
  if (difficultyGenerationDisabledReason(input.instrument) !== undefined) {
    throw new UnsupportedInstrumentError(input.instrument);
  }
  if (options.signal?.aborted) {
    throw makeAbortError();
  }

  const createWorker = options.createWorker ?? defaultCreateWorker;
  const request: DifficultyWorkerRequest =
    input.instrument === 'drums'
      ? {type: 'run', instrument: 'drums', input: input.input}
      : {
          type: 'run',
          instrument: 'guitar',
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
