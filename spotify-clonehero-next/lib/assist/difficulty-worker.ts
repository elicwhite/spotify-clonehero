/**
 * Web worker running difficulty-tier generation (plan 0074 Design D).
 *
 * Drums route through `lib/drum-difficulty/ours` (the trained GBM reducer,
 * "Ours" v5) — plan 0071 concluded "ship the trained GBM" and named no
 * competing production default, so Ours is this worker's only drum reducer;
 * HOPCAT/Onyx stay comparison-only tools on `/difficulties`. Guitar routes
 * through the ONNX reducer in `lib/guitar-difficulty` (models fetched lazily
 * from `assets.musiccharts.tools/models/guitar-reduction-v1` by
 * `loadGuitarReductionRuntime`, the same `getCachedModel`-style pattern other
 * workers in this codebase use for large model downloads).
 *
 * Bass never reaches this worker: `difficulty-client.ts` rejects it with a
 * typed `UnsupportedInstrumentError` before spawning (see that file's doc
 * comment for the spot-check gate outcome).
 *
 * Protocol: `{type:'run', instrument, ...}` ->
 * `{type:'progress', percent, detail?}`* -> `{type:'result', tiers}` |
 * `{type:'error', message}`. One job per worker instance; the client
 * terminates the worker on settle (`runAbortableWorker`).
 */

import {loadOursModels, reduceOurs} from '@/lib/drum-difficulty/ours/reduce';
import {reduceGuitarDifficulties} from '@/lib/guitar-difficulty/reduce';
import type {
  DifficultyWorkerMessage,
  DifficultyWorkerRequest,
} from './difficulty-protocol';

function post(msg: DifficultyWorkerMessage) {
  (self as unknown as Worker).postMessage(msg);
}

function progress(percent: number, detail?: string) {
  post({type: 'progress', percent, detail});
}

/** The guitar reducer's model-load + per-tier progress calls are plain
 *  strings with no percent (`loadGuitarReductionRuntime`'s `onProgress`,
 *  `reduceGuitarDifficulties`'s inline calls), so the percent is counted
 *  here: one call per step out of the {@link GUITAR_PROGRESS_STEPS} the
 *  reducer makes for `TIERS` tiers (1 manifest load + 1 model load and 1
 *  reduction per tier). The fraction is clamped, so a reducer that grows a
 *  step reads as pinned-at-100% rather than overshooting; keep this count in
 *  step with `reduceGuitarDifficulties`. */
const GUITAR_PROGRESS_STEPS = 1 + 2 * 3;

function makeGuitarProgressCounter(total = GUITAR_PROGRESS_STEPS) {
  let done = 0;
  return (message: string) => {
    done += 1;
    progress(Math.min(1, done / total), message);
  };
}

async function run(req: DifficultyWorkerRequest): Promise<void> {
  if (req.instrument === 'drums') {
    progress(0, 'Loading drum difficulty models');
    const models = await loadOursModels();
    progress(0.5, 'Reducing drum difficulties');
    const tiers = reduceOurs(req.input, models);
    progress(1);
    post({type: 'result', tiers: {kind: 'drums', ...tiers}});
    return;
  }

  // guitar (and, per the spot-check gate below, never bass in production —
  // the client rejects bass before this worker is ever spawned).
  const onGuitarProgress = makeGuitarProgressCounter();
  const {expert: _expert, ...reducedTiers} = await reduceGuitarDifficulties(
    req.chart,
    req.expertTrack,
    p => onGuitarProgress(p.message),
  );
  progress(1);
  post({type: 'result', tiers: {kind: 'guitar', ...reducedTiers}});
}

self.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as DifficultyWorkerRequest;
  if (msg.type === 'run') {
    run(msg).catch(err => {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
});
