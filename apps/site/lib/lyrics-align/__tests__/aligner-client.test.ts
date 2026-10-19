/**
 * The page side of the alignment worker: a failure must reach the caller as
 * an `AlignFailureError` that keeps the worker's reason, because the reason
 * is the only part of the failure that telemetry is allowed to see.
 */

import type {AlignFailureError} from '@/lib/lyrics-align/align-failure';

type Listener = (e: {data?: unknown; message?: string}) => void;

/** A worker whose replies the test sends with `emit`. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners: Record<string, Listener[]> = {};
  posted: unknown[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(l => l !== fn);
  }
  postMessage(msg: {type: string}) {
    this.posted.push(msg);
  }
  terminate() {}
  emit(type: string, event: {data?: unknown; message?: string}) {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
  }
}

const originalWorker = (globalThis as {Worker?: unknown}).Worker;

beforeEach(() => {
  FakeWorker.instances = [];
  (globalThis as {Worker?: unknown}).Worker = FakeWorker;
});

afterAll(() => {
  (globalThis as {Worker?: unknown}).Worker = originalWorker;
});

/**
 * A fresh copy of the client module, so its worker singleton is new, and the
 * error class from the same module registry, so `instanceof` holds.
 */
function loadClient(): typeof import('@/lib/lyrics-align/aligner') & {
  AlignFailureError: typeof AlignFailureError;
} {
  let mod!: typeof import('@/lib/lyrics-align/aligner');
  let failure!: typeof import('@/lib/lyrics-align/align-failure');
  jest.isolateModules(() => {
    mod = require('../aligner');
    failure = require('../align-failure');
  });
  return {...mod, AlignFailureError: failure.AlignFailureError};
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}

test('a worker error message rejects with its reason', async () => {
  const {init, AlignFailureError} = loadClient();
  const promise = init();
  const worker = FakeWorker.instances[0];

  worker.emit('message', {
    data: {
      type: 'error',
      message: 'Couldn’t reach the AI model server.',
      reason: 'model-download-network',
    },
  });

  const err = await rejectionOf(promise);
  expect(err).toBeInstanceOf(AlignFailureError);
  expect((err as AlignFailureError).reason).toBe('model-download-network');
  expect((err as AlignFailureError).message).toBe(
    'Couldn’t reach the AI model server.',
  );
});

test('an align failure after a good init keeps the worker’s reason', async () => {
  const {alignVocals, AlignFailureError} = loadClient();
  const promise = alignVocals(new Float32Array(16000), 'hello world');
  const worker = FakeWorker.instances[0];

  worker.emit('message', {data: {type: 'initDone'}});
  // Let `alignVocals` get past `await init()` and post the align message.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(worker.posted.map(m => (m as {type: string}).type)).toEqual([
    'init',
    'align',
  ]);
  worker.emit('message', {
    data: {
      type: 'error',
      message: 'session failed',
      reason: 'session-wasm-fp16',
    },
  });

  const err = await rejectionOf(promise);
  expect(err).toBeInstanceOf(AlignFailureError);
  expect((err as AlignFailureError).reason).toBe('session-wasm-fp16');
});

test('a worker that dies rejects with worker-error', async () => {
  const {init, AlignFailureError} = loadClient();
  const promise = init();
  const worker = FakeWorker.instances[0];

  worker.emit('error', {message: ''});

  const err = await rejectionOf(promise);
  expect(err).toBeInstanceOf(AlignFailureError);
  expect((err as AlignFailureError).reason).toBe('worker-error');
});
