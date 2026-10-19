/**
 * Waits for the ONNX Runtime bundle to appear on `globalThis`.
 *
 * ORT is loaded by a page-level `<Script>` tag rather than imported, so any
 * flow that spawns an inference worker has to gate on the global being
 * present. `/drum-transcription`'s home screen (which shows a
 * 'loading-runtime' step while it waits) and the in-editor assist runs share
 * this poll so neither can start a run against a runtime that hasn't landed.
 */

import {makeAbortError} from '@/lib/workers/abortable-worker';

const POLL_INTERVAL_MS = 100;

/** How long to keep polling before giving up. A script tag that never loads
 *  (blocked, offline, 404) would otherwise hang the caller forever with no
 *  message; failing loudly lets the run surface a real error instead. */
const DEFAULT_TIMEOUT_MS = 60_000;

function ortLoaded(): boolean {
  return Boolean((globalThis as {ort?: unknown}).ort);
}

export interface WaitForOrtRuntimeOptions {
  /** Fires only when a wait is actually needed, so callers can show a
   *  runtime-loading state without flashing it on the common path. */
  onWaiting?: (() => void) | undefined;
  timeoutMs?: number | undefined;
  /** Aborting stops the poll and rejects with an `AbortError`, so a
   *  cancelled run leaves no timer running and no late rejection behind. */
  signal?: AbortSignal | undefined;
}

/**
 * Resolves as soon as ORT is on `globalThis` — immediately when it already
 * is, and without any timer in that case. Rejects if the runtime hasn't
 * appeared within `timeoutMs`, or as soon as `signal` aborts.
 */
export function waitForOrtRuntime({
  onWaiting,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: WaitForOrtRuntimeOptions = {}): Promise<void> {
  if (signal?.aborted) return Promise.reject(makeAbortError());
  if (ortLoaded()) return Promise.resolve();
  onWaiting?.();
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    /** Stops the poll, detaches the abort listener, and settles once. */
    const finish = (outcome: () => void) => {
      clearInterval(interval);
      signal?.removeEventListener('abort', onAbort);
      outcome();
    };
    const onAbort = () => finish(() => reject(makeAbortError()));

    const interval = setInterval(() => {
      if (ortLoaded()) {
        finish(resolve);
      } else if (Date.now() >= deadline) {
        finish(() =>
          reject(
            new Error(
              'ONNX Runtime did not finish loading. Check your connection and reload the page.',
            ),
          ),
        );
      }
    }, POLL_INTERVAL_MS);

    signal?.addEventListener('abort', onAbort, {once: true});
  });
}
