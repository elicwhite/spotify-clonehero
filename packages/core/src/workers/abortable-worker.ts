/**
 * The one cancellation protocol every one-shot worker client in this
 * codebase uses.
 *
 * Each client (BS-Roformer separation, the tempo pipeline, Demucs, the CRNN
 * transcriber) spawns a worker, runs exactly one job, and terminates it to
 * reclaim WASM/GPU memory. The cancellation semantics are identical for all
 * of them, so they live here rather than being hand-written per client:
 *
 * - an already-aborted signal rejects before any worker is spawned;
 * - aborting mid-run terminates the worker immediately and rejects with a
 *   `DOMException` named `AbortError`;
 * - however the run settles, the worker is terminated once and the abort
 *   listener is removed, so a long-lived signal never accumulates listeners
 *   and a post-settle abort is inert.
 *
 * A client is then only its message protocol: wire `onmessage`, post the
 * request, call `settle.resolve`/`settle.reject`.
 */

/** Builds a DOMException matching the AbortSignal rejection contract. */
export function makeAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** The rejection every cancellable client in this codebase produces. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** How a worker body finishes its run. Either call terminates the worker
 *  and detaches the abort listener; later calls are ignored. */
export interface WorkerSettle<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Runs one job on a freshly spawned worker under the protocol above.
 *
 * `body` receives the live worker and the settle handles; it should attach
 * `onmessage`/`onerror` and post the request. It runs synchronously inside
 * the returned promise's executor, so the worker is observable to the caller
 * on the same tick it was created. A throw from `body` rejects the run and
 * terminates the worker.
 */
export function runAbortableWorker<T>(
  createWorker: () => Worker,
  signal: AbortSignal | undefined,
  body: (worker: Worker, settle: WorkerSettle<T>) => void,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(makeAbortError());

  return new Promise<T>((resolve, reject) => {
    const worker = createWorker();
    let settled = false;

    /** Terminates the worker, detaches the abort listener, and hands the
     *  outcome to the caller — once, whichever of abort/resolve/reject wins. */
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      outcome();
    };

    const onAbort = () => finish(() => reject(makeAbortError()));
    signal?.addEventListener('abort', onAbort);

    const settle: WorkerSettle<T> = {
      resolve: value => finish(() => resolve(value)),
      reject: error => finish(() => reject(error)),
    };

    try {
      body(worker, settle);
    } catch (err) {
      settle.reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
