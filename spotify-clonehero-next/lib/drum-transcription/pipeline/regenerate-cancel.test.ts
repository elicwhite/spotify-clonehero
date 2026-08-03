/**
 * Regeneration cancellation contract (plan 0074 Phase 1).
 *
 * `regenerateProject` recomputes a project's tempo map and predicted notes
 * and replaces the persisted artifacts only once the whole run has
 * succeeded. These tests pin both halves of that: a cancel at any stage
 * rejects with an `AbortError` and leaves every persisted artifact byte-
 * identical, and a successful run replaces them (and clears the leading-
 * silence anchor).
 *
 * Project storage (via the shared `fake-project-opfs` mock), separation, the
 * tempo pipeline, and the transcriber are mocked module boundaries; the
 * chart is built and serialized for real.
 */

import type {RawDrumEvent, TranscriptionResult} from '../ml/types';
import type {DrumTranscriber} from '../ml/transcriber';
import type {Synctrack} from '@/lib/tempo-map/types';
import {regenerateProject} from './runner';
import {SYNCTRACK_FILE} from './stages';
import {DECODED_ONSETS_FILE} from './decoded-onsets';
import * as opfs from '../storage/opfs';

jest.mock('../storage/opfs', () =>
  jest
    .requireActual<
      typeof import('../storage/__tests__/fake-project-opfs')
    >('../storage/__tests__/fake-project-opfs')
    .createProjectOpfsMock(),
);

jest.mock('../ml/roformer-separation', () => ({
  separateDrums: jest.fn(async () => {}),
  hasDrumStem: jest.fn(async () => true),
  loadDrumStem: jest.fn(async () => new Float32Array(512)),
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
  runTempoPipelineFromPcm: jest.fn(),
}));

import {runTempoPipelineFromPcm} from '@/lib/tempo-map/pipeline-client';
import type {ProjectOpfsMock} from '../storage/__tests__/fake-project-opfs';

const mockOpfs = opfs as unknown as ProjectOpfsMock;
const mockTempo = runTempoPipelineFromPcm as jest.Mock;

const PROJECT_ID = 'proj-regen';
const ORIGINAL_CHART = new Uint8Array([1, 2, 3]);

const EVENTS: RawDrumEvent[] = [
  {timeSeconds: 0.5, drumClass: 'BD', midiPitch: 36, confidence: 0.91},
  {timeSeconds: 1.0, drumClass: 'SD', midiPitch: 38, confidence: 0.72},
];

const PREDICTED_SYNCTRACK: Synctrack = {
  origin_ms: 0,
  tempos: [{ms: 0, bpm: 132}],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

function makeAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** Rejects with an AbortError as soon as `signal` fires — the shape every
 *  cancellable worker client in this codebase presents. */
function rejectOnAbort<T>(signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((_, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    signal?.addEventListener('abort', () => reject(makeAbortError()), {
      once: true,
    });
  });
}

function fakeTranscriber(
  onTranscribe?: (signal: AbortSignal | undefined) => Promise<void>,
): DrumTranscriber {
  return {
    transcribe: async (
      _audio: Float32Array,
      _rate: number,
      _onProgress?: unknown,
      signal?: AbortSignal,
    ): Promise<TranscriptionResult> => {
      await onTranscribe?.(signal);
      return {
        events: EVENTS,
        modelOutput: {
          predictions: new Float32Array(0),
          nFrames: 0,
          nClasses: 9,
        },
        durationSeconds: 4,
      };
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
    audioAnchor: {tick: 192, ms: 500},
  });
  mockOpfs.__files.set(`${PROJECT_ID}/notes.chart`, ORIGINAL_CHART);
  mockOpfs.__files.set(`${PROJECT_ID}/notes.edited.chart`, ORIGINAL_CHART);
  mockOpfs.__files.set(
    `${PROJECT_ID}/review-progress.json`,
    JSON.stringify({reviewed: 12}),
  );
  mockOpfs.__files.set(
    `${PROJECT_ID}/${SYNCTRACK_FILE}`,
    JSON.stringify({synctrack: {origin_ms: 0, tempos: [{ms: 0, bpm: 90}]}}),
  );
  mockOpfs.__files.set(
    `${PROJECT_ID}/${DECODED_ONSETS_FILE}`,
    JSON.stringify({version: 1}),
  );
}

function persisted(fileName: string): unknown {
  return mockOpfs.__files.get(`${PROJECT_ID}/${fileName}`);
}

const noProgress = () => {};

beforeEach(() => {
  mockOpfs.__reset();
  jest.clearAllMocks();
  seedProject();
});

describe('regenerateProject cancellation', () => {
  it('a cancel during tempo mapping rejects with AbortError and leaves every persisted artifact untouched', async () => {
    mockTempo.mockImplementation(
      (_pcm: unknown, options: {signal?: AbortSignal}) =>
        rejectOnAbort(options.signal),
    );
    const controller = new AbortController();

    const run = regenerateProject(
      PROJECT_ID,
      p => {
        if (p.step === 'tempo-mapping') controller.abort();
      },
      fakeTranscriber(),
      {signal: controller.signal},
    );

    await expect(run).rejects.toMatchObject({name: 'AbortError'});

    expect(persisted('notes.chart')).toBe(ORIGINAL_CHART);
    expect(persisted('notes.edited.chart')).toBe(ORIGINAL_CHART);
    expect(persisted('review-progress.json')).toBe(
      JSON.stringify({reviewed: 12}),
    );
    expect(persisted(SYNCTRACK_FILE)).toBe(
      JSON.stringify({synctrack: {origin_ms: 0, tempos: [{ms: 0, bpm: 90}]}}),
    );
    expect(persisted(DECODED_ONSETS_FILE)).toBe(JSON.stringify({version: 1}));
    expect(mockOpfs.deleteProjectFile).not.toHaveBeenCalled();
    // The leading-silence anchor survives a cancelled run.
    expect(mockOpfs.__projects.get(PROJECT_ID)?.['audioAnchor']).toEqual({
      tick: 192,
      ms: 500,
    });
  });

  it('a cancel during transcription rejects and writes nothing', async () => {
    mockTempo.mockResolvedValue({
      synctrack: PREDICTED_SYNCTRACK,
      sections: null,
      meterStats: null,
      drumOnsetOffsetMs: 0,
    });
    const controller = new AbortController();

    const run = regenerateProject(
      PROJECT_ID,
      p => {
        if (p.step === 'transcribing') controller.abort();
      },
      fakeTranscriber(signal => rejectOnAbort(signal)),
      {signal: controller.signal},
    );

    await expect(run).rejects.toMatchObject({name: 'AbortError'});

    expect(persisted('notes.chart')).toBe(ORIGINAL_CHART);
    expect(persisted('review-progress.json')).toBe(
      JSON.stringify({reviewed: 12}),
    );
    // The freshly predicted tempo map is not persisted either: the run's
    // outputs land together or not at all.
    expect(persisted(SYNCTRACK_FILE)).toBe(
      JSON.stringify({synctrack: {origin_ms: 0, tempos: [{ms: 0, bpm: 90}]}}),
    );
    expect(mockOpfs.deleteProjectFile).not.toHaveBeenCalled();
  });

  it('an already-aborted signal rejects before any work starts', async () => {
    mockTempo.mockImplementation(() => {
      throw new Error('tempo pipeline must not run');
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      regenerateProject(PROJECT_ID, noProgress, fakeTranscriber(), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({name: 'AbortError'});
    expect(mockTempo).not.toHaveBeenCalled();
  });

  it('threads the signal into the tempo pipeline and the transcriber', async () => {
    mockTempo.mockResolvedValue({
      synctrack: PREDICTED_SYNCTRACK,
      sections: null,
      meterStats: null,
      drumOnsetOffsetMs: 0,
    });
    const controller = new AbortController();
    let transcriberSignal: AbortSignal | undefined;

    await regenerateProject(
      PROJECT_ID,
      noProgress,
      fakeTranscriber(async signal => {
        transcriberSignal = signal;
      }),
      {signal: controller.signal},
    );

    expect(mockTempo.mock.calls[0][1].signal).toBe(controller.signal);
    expect(transcriberSignal).toBe(controller.signal);
  });
});

describe('regenerateProject success', () => {
  beforeEach(() => {
    mockTempo.mockResolvedValue({
      synctrack: PREDICTED_SYNCTRACK,
      sections: null,
      meterStats: null,
      drumOnsetOffsetMs: 0,
    });
  });

  it('replaces the chart, persists the freshly predicted tempo map, and discards review progress', async () => {
    await regenerateProject(PROJECT_ID, noProgress, fakeTranscriber());

    expect(persisted('notes.chart')).not.toBe(ORIGINAL_CHART);
    expect(persisted('notes.edited.chart')).toBeUndefined();
    expect(persisted('review-progress.json')).toBeUndefined();
    expect(JSON.parse(persisted(SYNCTRACK_FILE) as string).synctrack).toEqual(
      PREDICTED_SYNCTRACK,
    );
    expect(persisted('confidence.json')).toBeDefined();
    expect(persisted(DECODED_ONSETS_FILE)).toBeDefined();
  });

  it('clears the leading-silence anchor', async () => {
    await regenerateProject(PROJECT_ID, noProgress, fakeTranscriber());

    expect(mockOpfs.__projects.get(PROJECT_ID)?.['audioAnchor']).toBeNull();
    expect(mockOpfs.__projects.get(PROJECT_ID)?.['stage']).toBe('editing');
  });

  it('ignores a stored tempo map and predicts a fresh one', async () => {
    await regenerateProject(PROJECT_ID, noProgress, fakeTranscriber());

    expect(mockTempo).toHaveBeenCalledTimes(1);
  });
});
