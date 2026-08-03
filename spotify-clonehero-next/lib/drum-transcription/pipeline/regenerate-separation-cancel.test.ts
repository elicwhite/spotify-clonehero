/**
 * Cancelling a regeneration during stem separation really stops the GPU
 * work (plan 0074 Phase 1, "cancel actually stops workers").
 *
 * Unlike `regenerate-cancel.test.ts`, which mocks the separation boundary to
 * pin the persisted-artifact contract, this exercises the whole separation
 * chain for real — `regenerateProject` -> `resumePipeline` ->
 * `separateDrumsStep` -> `separateDrums` -> `separateStems` ->
 * `runSeparationInWorker` -> the worker — and asserts the abort reaches the
 * worker itself. Only the leaves are stubbed: project storage (the shared
 * `fake-project-opfs` mock), audio decode, and the `Worker` constructor
 * (`separateStems` has no createWorker seam of its own; the same global stub
 * `separate-stems-cancel.test.ts` uses). The stem cache underneath runs for
 * real against `fake-opfs`.
 */

import type {TranscriptionResult} from '../ml/types';
import type {DrumTranscriber} from '../ml/transcriber';
import {regenerateProject} from './runner';
import {installFakeOPFS} from '../storage/__tests__/fake-opfs';

jest.mock('../storage/opfs', () =>
  jest
    .requireActual<
      typeof import('../storage/__tests__/fake-project-opfs')
    >('../storage/__tests__/fake-project-opfs')
    .createProjectOpfsMock({fullMixPcmSamples: 8}),
);

jest.mock('../../audio-pipeline/decode-audio', () => ({
  decodeAndResampleTo44k: jest.fn(async () => {
    const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const right = new Float32Array([0.5, 0.6, 0.7, 0.8]);
    return {
      length: left.length,
      numberOfChannels: 2,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    } as unknown as AudioBuffer;
  }),
}));

jest.mock('../../audio/opus-encoder', () => ({
  encodePcmToOpus: jest.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));

jest.mock('./crnn-audio-prep', () => ({
  CRNN_SAMPLE_RATE: 48000,
  planarStereoToCrnnInput: jest.fn(
    async (left: Float32Array) => new Float32Array(left.length * 2),
  ),
}));

jest.mock('../ml/transcriber', () => ({
  CrnnTranscriber: class {
    transcribe(): never {
      throw new Error('real transcriber must not run in tests');
    }
  },
}));

jest.mock('../../tempo-map/pipeline-client', () => ({
  runTempoPipelineFromPcm: jest.fn(async () => {
    throw new Error('tempo pipeline must not be reached in these tests');
  }),
}));

import * as opfs from '../storage/opfs';
import type {ProjectOpfsMock} from '../storage/__tests__/fake-project-opfs';

const mockOpfs = opfs as unknown as ProjectOpfsMock;

const PROJECT_ID = 'proj-sep-cancel';
const ORIGINAL_CHART = new Uint8Array([9, 9, 9]);

class FakeWorker {
  onmessage: ((e: {data: unknown}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
}

function fakeTranscriber(): DrumTranscriber {
  return {
    transcribe: async (): Promise<TranscriptionResult> => {
      throw new Error('transcription must not be reached in these tests');
    },
  };
}

function seedProject(): void {
  mockOpfs.__projects.set(PROJECT_ID, {
    id: PROJECT_ID,
    name: 'Song',
    createdAt: '',
    updatedAt: '',
    durationSeconds: 4,
    stage: 'editing',
    gridSource: 'predicted',
    // Pinned so the fingerprint never depends on hashing here; the stem
    // cache (real, on the fake OPFS) is empty, so separation must run.
    stemFingerprint: 'fingerprint-with-no-cached-stem',
  });
  mockOpfs.__files.set(`${PROJECT_ID}/notes.chart`, ORIGINAL_CHART);
}

let fakeWorker: FakeWorker | null = null;
let originalWorker: typeof Worker | undefined;
let stemCacheStore: Map<string, ArrayBuffer>;

beforeEach(() => {
  stemCacheStore = installFakeOPFS().store;
  mockOpfs.__reset();
  jest.clearAllMocks();
  seedProject();
  fakeWorker = null;
  originalWorker = (globalThis as {Worker?: typeof Worker}).Worker;
  (globalThis as unknown as {Worker: unknown}).Worker = class {
    constructor() {
      fakeWorker = new FakeWorker();
      return fakeWorker as unknown as Worker;
    }
  };
});

afterEach(() => {
  (globalThis as unknown as {Worker: unknown}).Worker = originalWorker;
});

/** Waits (real timers: the cache probe + decode chain crosses macrotask
 * boundaries) until the separation worker has been spawned. */
async function waitForWorker(): Promise<void> {
  for (let i = 0; i < 500 && fakeWorker == null; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (fakeWorker == null) throw new Error('separation worker never spawned');
}

describe('regenerateProject cancellation during separation', () => {
  it('terminates the separation worker, rejects with AbortError, and leaves the persisted chart untouched', async () => {
    const controller = new AbortController();

    const run = regenerateProject(PROJECT_ID, () => {}, fakeTranscriber(), {
      signal: controller.signal,
    });
    run.catch(() => {});

    await waitForWorker();
    expect(fakeWorker!.terminated).toBe(false);

    controller.abort();

    await expect(run).rejects.toMatchObject({name: 'AbortError'});
    expect(fakeWorker!.terminated).toBe(true);
    expect(mockOpfs.__files.get(`${PROJECT_ID}/notes.chart`)).toBe(
      ORIGINAL_CHART,
    );
    expect(mockOpfs.deleteProjectFile).not.toHaveBeenCalled();
    // The interrupted separation cached nothing.
    expect(stemCacheStore.size).toBe(0);
  });

  it('never spawns a separation worker when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      regenerateProject(PROJECT_ID, () => {}, fakeTranscriber(), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({name: 'AbortError'});

    expect(fakeWorker).toBeNull();
  });
});
