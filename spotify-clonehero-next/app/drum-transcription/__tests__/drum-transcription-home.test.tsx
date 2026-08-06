/**
 * @jest-environment jsdom
 */
/**
 * `/drum-transcription` home screen on the assist engine (plan 0074 Phase 6,
 * Task 6c, Suite 7).
 *
 * `DrumTranscriptionClient` runs the shared `transcribe-drums` task
 * (`lib/assist/tasks/transcribe-drums.ts`) through its own
 * `useAssistRunnerControls()`, so the step list it renders is the engine's
 * own. `runner.ts` and `pipeline/stages.ts` execute
 * for real against the shared project-storage double; only the boundaries
 * that need a GPU or a real decoder are mocked (separation, the tempo
 * pipeline, CRNN audio prep + transcription, audio decoding), plus
 * `EditorApp`, which this suite never reaches.
 */

import '@testing-library/jest-dom';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import type {RawDrumEvent} from '@/lib/drum-transcription/ml/types';
import type {Synctrack} from '@/lib/tempo-map/types';

// jsdom's Blob has no arrayBuffer(); the pipeline reads its upload through it.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// The page gates itself on WebGPU + the WebCodecs encoder, neither of which
// jsdom has; this suite is about the pipeline behind that gate.
if (!('gpu' in navigator)) {
  Object.defineProperty(navigator, 'gpu', {value: {}, configurable: true});
}
const globals = globalThis as Record<string, unknown>;
globals['AudioEncoder'] ??= class {};
globals['AudioData'] ??= class {};

const mockPush = jest.fn();
let searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({push: mockPush}),
  useSearchParams: () => searchParams,
}));

jest.mock('next/script', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../components/EditorApp', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../../lib/drum-transcription/storage/opfs', () =>
  jest
    .requireActual<
      typeof import('../../../lib/drum-transcription/storage/__tests__/fake-project-opfs')
    >('../../../lib/drum-transcription/storage/__tests__/fake-project-opfs')
    .createProjectOpfsMock(),
);

jest.mock('../../../lib/drum-transcription/ml/roformer-separation', () => ({
  separateDrums: jest.fn(async () => {}),
  hasDrumStem: jest.fn(async () => true),
  loadDrumStem: jest.fn(async () => new Float32Array(512)),
}));

jest.mock('../../../lib/drum-transcription/pipeline/crnn-audio-prep', () => ({
  CRNN_SAMPLE_RATE: 48000,
  planarStereoToCrnnInput: jest.fn(
    async (left: Float32Array) => new Float32Array(left.length * 2),
  ),
}));

jest.mock('../../../lib/drum-transcription/ml/transcriber', () => ({
  CrnnTranscriber: class {
    async transcribe() {
      return {
        events: [
          {timeSeconds: 0.5, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
        ] as RawDrumEvent[],
        modelOutput: {
          predictions: new Float32Array(0),
          nFrames: 0,
          nClasses: 9,
        },
        durationSeconds: 4,
      };
    }
  },
}));

jest.mock('../../../lib/drum-transcription/audio/decoder', () => ({
  decodeAudio: jest.fn(async () => ({
    length: 256,
    duration: 4,
    sampleRate: 44100,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(256),
  })),
}));

jest.mock('../../../lib/tempo-map/pipeline-client', () => ({
  runTempoPipelineFromPcm: jest.fn(),
  runTempoPipeline: jest.fn(),
  defaultCreateWorker: jest.fn(),
}));

jest.mock('../../../lib/lyrics-align/aligner', () => ({
  alignVocals: jest.fn(),
}));

import * as opfs from '@/lib/drum-transcription/storage/opfs';
import type {ProjectOpfsMock} from '@/lib/drum-transcription/storage/__tests__/fake-project-opfs';
import {runTempoPipelineFromPcm} from '@/lib/tempo-map/pipeline-client';
import {transcribeDrumsTask} from '@/lib/assist/tasks/transcribe-drums';
import DrumTranscriptionClient from '../DrumTranscriptionClient';

const mockOpfs = opfs as unknown as ProjectOpfsMock;
const mockTempo = runTempoPipelineFromPcm as jest.Mock;

// The task waits for the page's ONNX Runtime <Script> before starting a run.
(globalThis as {ort?: unknown}).ort = {};

const PREDICTED_SYNCTRACK: Synctrack = {
  origin_ms: 0,
  tempos: [{ms: 0, bpm: 120}],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

/** Walks the picker to the audio uploader and hands it a file, the way the
 *  browser's file picker does. The input itself is visually hidden (a styled
 *  "Browse Files" button opens it), so it is reached by type. */
function uploadAudio(container: HTMLElement): void {
  fireEvent.click(
    screen.getByRole('button', {name: /just a song \(create a new chart\)/i}),
  );
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input rendered');
  const file = new File([new Uint8Array([1, 2, 3, 4])], 'song.mp3', {
    type: 'audio/mpeg',
  });
  fireEvent.change(input, {target: {files: [file]}});
}

beforeEach(() => {
  mockOpfs.__reset();
  jest.clearAllMocks();
  searchParams = new URLSearchParams();
  mockTempo.mockResolvedValue({
    synctrack: PREDICTED_SYNCTRACK,
    sections: null,
    meterStats: null,
    drumOnsetOffsetMs: 0,
  });
});

describe('/drum-transcription upload flow', () => {
  it('renders the engine step list and opens the editor when the run finishes', async () => {
    const {container} = render(<DrumTranscriptionClient />);
    await screen.findByRole('button', {
      name: /just a song \(create a new chart\)/i,
    });

    uploadAudio(container);

    expect(await screen.findByText('Processing: song.mp3')).toBeInTheDocument();
    expect(screen.getByText('Separating Stems')).toBeInTheDocument();
    expect(screen.getByText('Building Tempo Map')).toBeInTheDocument();
    expect(screen.getByText('Transcribing Drums')).toBeInTheDocument();

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('/drum-transcription?project='),
      ),
    );
  });

  it('names the stages it shares with a resumed run identically', async () => {
    const {container} = render(<DrumTranscriptionClient />);
    await screen.findByRole('button', {
      name: /just a song \(create a new chart\)/i,
    });

    uploadAudio(container);
    await screen.findByText('Processing: song.mp3');

    // A resume plans its own step list from the same task; the labels a
    // user reads for the shared stages must match.
    mockOpfs.__projects.set('proj-editor', {
      id: 'proj-editor',
      name: 'Song',
      createdAt: '',
      updatedAt: '',
      stage: 'separating',
      gridSource: 'predicted',
    });
    const rerunSteps = await transcribeDrumsTask.planSteps({
      run: {kind: 'resume', projectId: 'proj-editor'},
    });

    for (const step of rerunSteps) {
      expect(screen.getByText(step.label)).toBeInTheDocument();
    }
  });

  it('cancel aborts the in-flight run and returns to the picker', async () => {
    let tempoSignal: AbortSignal | undefined;
    mockTempo.mockImplementation(
      (_pcm: unknown, options: {signal?: AbortSignal}) =>
        new Promise((_resolve, reject) => {
          tempoSignal = options.signal;
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const {container} = render(<DrumTranscriptionClient />);
    await screen.findByRole('button', {
      name: /just a song \(create a new chart\)/i,
    });

    uploadAudio(container);
    await screen.findByText('Processing: song.mp3');
    await waitFor(() => expect(tempoSignal).toBeDefined());

    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    expect(tempoSignal?.aborted).toBe(true);
    expect(
      await screen.findByRole('button', {
        name: /just a song \(create a new chart\)/i,
      }),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps a failed run on screen with a retry that resumes its project', async () => {
    // The tempo stage swallows non-abort failures and falls back to a flat
    // chart, so fail a stage that has no fallback: the transcriber's audio
    // prep, once, so the retry succeeds.
    const prep = jest.requireMock(
      '../../../lib/drum-transcription/pipeline/crnn-audio-prep',
    ) as {planarStereoToCrnnInput: jest.Mock};
    prep.planarStereoToCrnnInput.mockRejectedValueOnce(
      new Error('audio prep exploded'),
    );

    const {container} = render(<DrumTranscriptionClient />);
    await screen.findByRole('button', {
      name: /just a song \(create a new chart\)/i,
    });

    uploadAudio(container);

    expect(await screen.findByText('audio prep exploded')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    // The failed run had already created its project, so Retry resumes that
    // one: no second project, and the separation it already did is reused.
    const projectId = [...mockOpfs.__projects.keys()][0];
    expect(projectId).toBeDefined();

    fireEvent.click(screen.getByRole('button', {name: /^retry$/i}));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/drum-transcription?project=${projectId}`,
      ),
    );
    expect(mockOpfs.__projects.size).toBe(1);
  });
});

describe('/drum-transcription resume from ?project=', () => {
  it('resumes an interrupted project and reveals the editor when it completes', async () => {
    mockOpfs.__projects.set('proj-interrupted', {
      id: 'proj-interrupted',
      name: 'Interrupted Song',
      createdAt: '',
      updatedAt: '',
      stage: 'separating',
      gridSource: 'predicted',
    });
    searchParams = new URLSearchParams('project=proj-interrupted');

    // Hold the tempo stage open long enough to observe the processing view
    // the resume renders in place of the editor.
    let releaseTempo!: () => void;
    mockTempo.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseTempo = () =>
            resolve({
              synctrack: PREDICTED_SYNCTRACK,
              sections: null,
              meterStats: null,
              drumOnsetOffsetMs: 0,
            });
        }),
    );

    render(<DrumTranscriptionClient />);

    expect(
      await screen.findByText('Processing: Interrupted Song'),
    ).toBeInTheDocument();
    expect(screen.getByText('Transcribing Drums')).toBeInTheDocument();
    releaseTempo();

    // The run picks up where the interruption left it: nothing to decode or
    // separate again, so it only has to map tempo and transcribe.
    await waitFor(() =>
      expect(mockOpfs.__projects.get('proj-interrupted')?.['stage']).toBe(
        'editing',
      ),
    );
    expect(mockTempo).toHaveBeenCalledTimes(1);
    // Resuming happens in place; the page never navigates itself.
    expect(mockPush).not.toHaveBeenCalled();
  });
});
