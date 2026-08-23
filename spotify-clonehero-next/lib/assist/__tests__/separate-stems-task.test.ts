/**
 * The `separate-stems` task (plan 0123): the two model arms, what each one
 * writes into the stem cache, and what its step list promises before it runs.
 *
 * The cache is the task's whole product, so every assertion reads the fake
 * cache's writes. Mocked at the module boundaries that need a GPU, a real
 * decoder, or WebCodecs: the two separators, `decodeAndResampleTo44k`, the
 * PCM worker, the Opus encoder, and the model-cache probes.
 */

import type {AssistAudio} from '../tasks/types';
import type {StepProgressEvent} from '../run-to-steps';

// jest.mock's first argument is a bare string Jest resolves directly, so the
// registrations below use relative paths to the same files the `@/...`
// imports resolve to.

// ---------------------------------------------------------------------------
// Stem cache — an in-memory stand-in keyed exactly as the real one is.
// ---------------------------------------------------------------------------
const stored = new Map<string, Uint8Array>();
const key = (fingerprint: string, stem: string, kind: string) =>
  `${fingerprint}/${stem}.${kind}`;

jest.mock('../../audio-pipeline/stem-cache', () => {
  const actual = jest.requireActual('../../audio-pipeline/stem-cache');
  return {
    ...actual,
    // Real fingerprints hash the bytes AND the separator id; this keeps the
    // property that matters here — one key per separator — without the
    // crypto.
    computeStemFingerprint: jest.fn(
      async (bytes: Uint8Array, separatorId: string) =>
        `${separatorId}#${bytes[0]}`,
    ),
    hasStem: jest.fn(async (fingerprint: string, stem: string) =>
      stored.has(key(fingerprint, stem, 'f32.gz')),
    ),
    hasStemOpus: jest.fn(async (fingerprint: string, stem: string) =>
      stored.has(key(fingerprint, stem, 'opus')),
    ),
    storeStemBytes: jest.fn(
      async (fingerprint: string, stem: string, bytes: Uint8Array) => {
        stored.set(key(fingerprint, stem, 'f32.gz'), bytes);
      },
    ),
    storeStemOpus: jest.fn(
      async (fingerprint: string, stem: string, bytes: Uint8Array) => {
        stored.set(key(fingerprint, stem, 'opus'), bytes);
      },
    ),
  };
});

// ---------------------------------------------------------------------------
// The two separators.
// ---------------------------------------------------------------------------
const separateStemsMock = jest.fn(async () => ({}));
jest.mock('../../audio-pipeline/separate-stems', () => {
  const actual = jest.requireActual('../../audio-pipeline/separate-stems');
  return {
    ...actual,
    separateStems: (...args: unknown[]) =>
      (separateStemsMock as unknown as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      ),
  };
});

const stereo = (n: number) => ({
  left: new Float32Array(n),
  right: new Float32Array(n),
});
/** The separated stems a run produces, overridable per test. */
let demucsStems: Record<string, unknown> = {};
/** Stands in for the worker: reports one tick from each phase the real
 *  client distinguishes, then hands back the stems. */
const demucsMock = jest.fn(
  async (
    _audio: unknown,
    _want: unknown,
    onProgress?: (p: {phase: string; message: string}) => void,
  ) => {
    onProgress?.({phase: 'loading-model', message: 'Downloading...'});
    onProgress?.({phase: 'separating', message: 'Separating segment 1/2'});
    return demucsStems;
  },
);
jest.mock('../../lyrics-align/demucs-client', () => ({
  defaultCreateDemucsWorker: jest.fn(),
  runDemucsInWorker: (...args: unknown[]) =>
    (demucsMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));

// ---------------------------------------------------------------------------
// Everything else a run touches that jsdom/node cannot provide.
// ---------------------------------------------------------------------------
jest.mock('../../audio-pipeline/decode-audio', () => ({
  decodeAndResampleTo44k: jest.fn(async () => ({
    length: 8,
    sampleRate: 44100,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(8),
  })),
}));

jest.mock('../../audio-pipeline/pcm-client', () => ({
  encodeStemCacheBytesInWorker: jest.fn(async () => ({
    bytes: new Uint8Array([7, 7, 7]),
    stem: {left: new Float32Array(8), right: new Float32Array(8)},
  })),
}));

jest.mock('../../audio/opus-encoder', () => ({
  isOpusEncodeSupported: jest.fn(() => true),
  encodePcmToOpus: jest.fn(async () => new Uint8Array([9])),
}));

const roformerModelCached = jest.fn(async () => false);
jest.mock('../../tempo-map/models', () => ({
  hasRoformerModelCached: () => roformerModelCached(),
}));

const demucsModelCached = jest.fn(async () => false);
jest.mock('../../lyrics-align/model-urls', () => ({
  MODEL_URLS: {demucs: 'demucs-url'},
  hasDemucsModelCached: () => demucsModelCached(),
}));

import {
  DEMUCS_SEPARATOR_ID,
  DEMUCS_STEREO_SEPARATOR_ID,
  ROFORMER_SEPARATOR_ID,
} from '../../audio-pipeline/stem-cache';
import {makeSeparateStemsTask} from '../tasks/separate-stems';

const AUDIO_BYTE = 5;
const task = makeSeparateStemsTask();

function audio(): AssistAudio {
  return {
    loadOriginalBytes: async () => new Uint8Array([AUDIO_BYTE]),
  };
}

const roformerKey = `${ROFORMER_SEPARATOR_ID}#${AUDIO_BYTE}`;
const demucsStereoKey = `${DEMUCS_STEREO_SEPARATOR_ID}#${AUDIO_BYTE}`;
const demucsMonoKey = `${DEMUCS_SEPARATOR_ID}#${AUDIO_BYTE}`;

/** Runs a model arm to completion, collecting the steps it reported. */
async function run(model: 'demucs' | 'roformer'): Promise<string[]> {
  const seen: string[] = [];
  const progress = (event: StepProgressEvent) => {
    if (event.activeKey && !seen.includes(event.activeKey)) {
      seen.push(event.activeKey);
    }
  };
  await task.run(
    {audio: audio(), model},
    new AbortController().signal,
    progress,
  );
  return seen;
}

beforeEach(() => {
  stored.clear();
  jest.clearAllMocks();
  roformerModelCached.mockResolvedValue(false);
  demucsModelCached.mockResolvedValue(false);
  demucsStems = {
    drums: stereo(8),
    vocals: stereo(8),
    vocals16k: new Float32Array(4),
  };
});

describe('separate-stems: the roformer arm', () => {
  it('asks separateStems for what the cache is missing, and leaves the writing to it', async () => {
    await run('roformer');

    expect(separateStemsMock).toHaveBeenCalledTimes(1);
    const [bytes, opts] = separateStemsMock.mock.calls[0] as unknown as [
      Uint8Array,
      {drums: boolean; vocals: boolean},
    ];
    expect(Array.from(bytes)).toEqual([AUDIO_BYTE]);
    expect(opts.drums).toBe(true);
    expect(opts.vocals).toBe(true);
    // `separateStems` owns both cache writes; this task must not shadow them
    // with writes of its own.
    expect([...stored.keys()]).toEqual([]);
  });

  it('does not separate again when both stems are already cached', async () => {
    stored.set(key(roformerKey, 'drums', 'f32.gz'), new Uint8Array([1]));
    stored.set(key(roformerKey, 'vocals', 'opus'), new Uint8Array([1]));

    const result = await task.run(
      {audio: audio(), model: 'roformer'},
      new AbortController().signal,
      () => {},
    );

    expect(separateStemsMock).not.toHaveBeenCalled();
    expect(result.separated).toEqual([]);
  });
});

describe('separate-stems: the demucs arm', () => {
  it('writes the full-rate pair under its own key, and the mono vocals under the aligner’s', async () => {
    const result = await task.run(
      {audio: audio(), model: 'demucs'},
      new AbortController().signal,
      () => {},
    );

    expect(demucsMock).toHaveBeenCalledTimes(1);
    expect(demucsMock.mock.calls[0][1]).toEqual({
      drums: true,
      vocals: true,
      vocals16k: true,
    });
    expect([...stored.keys()].sort()).toEqual(
      [
        key(demucsStereoKey, 'drums', 'f32.gz'),
        key(demucsStereoKey, 'vocals', 'opus'),
        key(demucsMonoKey, 'vocals', 'opus'),
      ].sort(),
    );
    expect(result.separated).toEqual(['drums', 'vocals']);
  });

  it('never writes into the BS-Roformer entry, so a task wanting that output still separates for itself', async () => {
    await run('demucs');
    expect([...stored.keys()].some(k => k.startsWith(roformerKey))).toBe(false);
  });

  it('asks only for what is missing when an earlier lyrics run already cached the mono vocals', async () => {
    stored.set(key(demucsMonoKey, 'vocals', 'opus'), new Uint8Array([1]));
    demucsStems = {drums: stereo(8), vocals: stereo(8)};

    await run('demucs');

    expect(demucsMock.mock.calls[0][1]).toEqual({
      drums: true,
      vocals: true,
      vocals16k: false,
    });
  });

  it('reports the download, the separation and the store as it goes', async () => {
    expect(await run('demucs')).toEqual([
      'download-model',
      'separate',
      'store',
    ]);
  });
});

describe('separate-stems: the step list', () => {
  it('predicts the model download until the model is cached', async () => {
    const [pending] = await task.planSteps({audio: audio(), model: 'roformer'});
    expect(pending).toMatchObject({key: 'download-model', cached: false});

    roformerModelCached.mockResolvedValue(true);
    const [downloaded] = await task.planSteps({
      audio: audio(),
      model: 'roformer',
    });
    expect(downloaded).toMatchObject({key: 'download-model', cached: true});
  });

  it('names the download the arm actually makes', async () => {
    const [demucsStep] = await task.planSteps({
      audio: audio(),
      model: 'demucs',
    });
    const [roformerStep] = await task.planSteps({
      audio: audio(),
      model: 'roformer',
    });
    expect(demucsStep.description).toContain('169 MB');
    expect(roformerStep.description).toContain('336 MB');
  });

  it('marks every step cached when the run would do nothing', async () => {
    stored.set(key(roformerKey, 'drums', 'f32.gz'), new Uint8Array([1]));
    stored.set(key(roformerKey, 'vocals', 'opus'), new Uint8Array([1]));

    const steps = await task.planSteps({audio: audio(), model: 'roformer'});
    expect(steps.every(step => step.cached)).toBe(true);
  });
});

describe('separate-stems: cancellation', () => {
  it('rejects before touching the audio when the signal has already fired', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      task.run({audio: audio(), model: 'demucs'}, controller.signal, () => {}),
    ).rejects.toMatchObject({name: 'AbortError'});
    expect(demucsMock).not.toHaveBeenCalled();
  });
});
