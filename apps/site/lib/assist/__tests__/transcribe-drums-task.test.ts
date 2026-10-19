/**
 * The `transcribe-drums` task's three compositions (plan 0074 Phase 6,
 * Suite 7): fresh upload, existing chart package, resume.
 *
 * These run `runner.ts` and `pipeline/stages.ts` for real against the shared
 * project-storage double, so what a step marked "cached" claims and what the
 * ordering actually skips are asserted against the same OPFS bookkeeping the
 * app performs. Only the module boundaries that need a GPU or a real decoder
 * are mocked: separation, the tempo pipeline, the CRNN transcriber's audio
 * prep, and audio decoding. Chart building and serialization are real, so a
 * run's notes are read back out of the bytes it persisted.
 */

import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote, writeChartFolder} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {Synctrack} from '@/lib/tempo-map/types';
import type {DrumTranscriber} from '@/lib/drum-transcription/ml/transcriber';
import type {RawDrumEvent} from '@/lib/drum-transcription/ml/types';

// jest.mock's first argument is a bare string Jest resolves directly (SWC
// only rewrites the `@/...` alias inside real `import` specifiers), so the
// mock registrations below use relative paths to the same files the `@/...`
// imports resolve to.
jest.mock('../../drum-transcription/storage/opfs', () =>
  jest
    .requireActual<
      typeof import('../../drum-transcription/storage/__tests__/fake-project-opfs')
    >('../../drum-transcription/storage/__tests__/fake-project-opfs')
    .createProjectOpfsMock(),
);

jest.mock('../../drum-transcription/ml/roformer-separation', () => ({
  separateDrums: jest.fn(async () => {}),
  hasDrumStem: jest.fn(async () => true),
  loadDrumStem: jest.fn(async () => new Float32Array(512)),
}));

jest.mock('../../drum-transcription/pipeline/crnn-audio-prep', () => ({
  CRNN_SAMPLE_RATE: 48000,
  planarStereoToCrnnInput: jest.fn(
    async (left: Float32Array) => new Float32Array(left.length * 2),
  ),
}));

jest.mock('../../drum-transcription/ml/transcriber', () => ({
  CrnnTranscriber: class {
    transcribe(): never {
      throw new Error('real transcriber must not run in tests');
    }
  },
}));

jest.mock('../../drum-transcription/audio/decoder', () => ({
  decodeAudio: jest.fn(async () => ({
    length: 256,
    duration: 4,
    sampleRate: 44100,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(256),
  })),
}));

jest.mock('../../tempo-map/pipeline-client', () => ({
  runTempoPipelineFromPcm: jest.fn(),
  runTempoPipeline: jest.fn(),
  defaultCreateWorker: jest.fn(),
}));

jest.mock('../../lyrics-align/aligner', () => ({alignVocals: jest.fn()}));

import * as opfs from '@/lib/drum-transcription/storage/opfs';
import type {ProjectOpfsMock} from '@/lib/drum-transcription/storage/__tests__/fake-project-opfs';
import {separateDrums} from '@/lib/drum-transcription/ml/roformer-separation';
import {runTempoPipelineFromPcm} from '@/lib/tempo-map/pipeline-client';
import {SYNCTRACK_FILE} from '@/lib/drum-transcription/pipeline/stages';
import {
  makeTranscribeDrumsTask,
  type TranscribeDrumsInput,
} from '../tasks/transcribe-drums';
import type {PlannedStep} from '../run-to-steps';

const mockOpfs = opfs as unknown as ProjectOpfsMock;
const mockSeparate = separateDrums as jest.Mock;
const mockTempo = runTempoPipelineFromPcm as jest.Mock;

// The task waits for the page's ONNX Runtime <Script> before starting a run.
// The runtime itself is never used here (every model call is mocked).
(globalThis as {ort?: unknown}).ort = {};

const EVENTS: RawDrumEvent[] = [
  {timeSeconds: 0.5, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
  {timeSeconds: 1.0, drumClass: 'SD', midiPitch: 38, confidence: 0.8},
];

const PREDICTED_SYNCTRACK: Synctrack = {
  origin_ms: 0,
  tempos: [{ms: 0, bpm: 132}],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

const transcriber: DrumTranscriber = {
  transcribe: async () => ({
    events: EVENTS,
    modelOutput: {predictions: new Float32Array(0), nFrames: 0, nClasses: 9},
    durationSeconds: 4,
  }),
};

const task = makeTranscribeDrumsTask({transcriber});
const noProgress = () => {};

function step(steps: PlannedStep[], key: string): PlannedStep {
  const found = steps.find(s => s.key === key);
  if (!found) throw new Error(`no planned step ${key}`);
  return found;
}

function persisted(projectId: string, fileName: string): unknown {
  return mockOpfs.__files.get(`${projectId}/${fileName}`);
}

/** A hand-written chart at 90 BPM with an (empty) Expert Drums track — the
 *  package a user brings to the chart flow. */
function handWrittenChart(): ChartDocument {
  const parsed = createEmptyChart({bpm: 90, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  return {parsedChart: parsed, assets: []};
}

function chartBytesWithNotes(): Uint8Array {
  const doc = handWrittenChart();
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  const files = writeChartFolder(doc);
  const chartFile = files.find(f => f.fileName === 'notes.chart');
  if (!chartFile) throw new Error('fixture: no chart file produced');
  return chartFile.data;
}

beforeEach(() => {
  mockOpfs.__reset();
  jest.clearAllMocks();
  mockSeparate.mockResolvedValue(undefined);
  mockTempo.mockResolvedValue({
    synctrack: PREDICTED_SYNCTRACK,
    sections: null,
    meterStats: null,
    drumOnsetOffsetMs: 0,
  });
});

describe('transcribe-drums: resume after an interrupted run', () => {
  const PROJECT_ID = 'proj-interrupted';

  /** A project whose separation finished before the tab closed: audio and
   *  drum stem stored, no tempo map, no chart. */
  function seedInterrupted(): void {
    mockOpfs.__projects.set(PROJECT_ID, {
      id: PROJECT_ID,
      name: 'Song',
      createdAt: '',
      updatedAt: '',
      stage: 'separating',
      gridSource: 'predicted',
    });
  }

  it('plans the already-persisted stages as cached and the rest as work', async () => {
    seedInterrupted();

    const steps = await task.planSteps({
      run: {kind: 'resume', projectId: PROJECT_ID},
    });

    expect(step(steps, 'decoding').cached).toBe(true);
    expect(step(steps, 'separating').cached).toBe(true);
    expect(step(steps, 'tempo-mapping').cached).toBe(false);
    expect(step(steps, 'transcribing').cached).toBe(false);
  });

  it('completes from the first incomplete stage without re-separating', async () => {
    seedInterrupted();

    const result = await task.run(
      {run: {kind: 'resume', projectId: PROJECT_ID}},
      new AbortController().signal,
      noProgress,
    );

    expect(mockSeparate).not.toHaveBeenCalled();
    expect(mockTempo).toHaveBeenCalledTimes(1);
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.notes).toHaveLength(EVENTS.length);
    // The tempo map is persisted as it lands, so a second interruption
    // wouldn't recompute it.
    expect(
      JSON.parse(persisted(PROJECT_ID, SYNCTRACK_FILE) as string).synctrack,
    ).toEqual(PREDICTED_SYNCTRACK);
    expect(persisted(PROJECT_ID, 'notes.chart')).toBeDefined();
    expect(persisted(PROJECT_ID, 'confidence.json')).toBeDefined();
    expect(mockOpfs.__projects.get(PROJECT_ID)?.['stage']).toBe('editing');
  });

  it('plans everything past separation as cached once a chart is on disk', async () => {
    seedInterrupted();
    mockOpfs.__files.set(`${PROJECT_ID}/notes.chart`, chartBytesWithNotes());

    const steps = await task.planSteps({
      run: {kind: 'resume', projectId: PROJECT_ID},
    });

    expect(step(steps, 'tempo-mapping').cached).toBe(true);
    expect(step(steps, 'transcribing').cached).toBe(true);
  });
});

describe('transcribe-drums: existing chart package', () => {
  function chartRunInput(): TranscribeDrumsInput {
    return {
      run: {
        kind: 'chart',
        input: {
          chartDoc: handWrittenChart(),
          audioFile: new File([new Uint8Array([1, 2, 3])], 'song.ogg'),
          packageInfo: {
            sourceFormat: 'folder' as const,
            originalName: 'Song',
          },
          extraAssets: [],
        },
      },
    };
  }

  beforeAll(() => {
    // jsdom's Blob has no arrayBuffer(); the chart flow reads its audio File
    // through it.
    if (!Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
        return Promise.resolve(new ArrayBuffer(3));
      };
    }
  });

  it('plans tempo mapping as work already done by the supplied chart', async () => {
    const steps = await task.planSteps(chartRunInput());

    const tempo = step(steps, 'tempo-mapping');
    expect(tempo.cached).toBe(true);
    expect(tempo.description).toBe('Using the tempo map from your chart');
  });

  it("never runs the tempo pipeline and keeps the chart's own grid", async () => {
    const result = await task.run(
      chartRunInput(),
      new AbortController().signal,
      noProgress,
    );

    expect(mockTempo).not.toHaveBeenCalled();
    expect(result.sync.tempos.map(t => t.beatsPerMinute)).toEqual(
      handWrittenChart().parsedChart.tempos.map(t => t.beatsPerMinute),
    );
    expect(result.notes).toHaveLength(EVENTS.length);
    expect(mockOpfs.__projects.get(result.projectId)?.['gridSource']).toBe(
      'provided',
    );
  });
});

describe('transcribe-drums: step labels across compositions', () => {
  it('names the shared stages identically for an upload and a resume', async () => {
    mockOpfs.__projects.set('proj-labels', {
      id: 'proj-labels',
      name: 'Song',
      createdAt: '',
      updatedAt: '',
      stage: 'separating',
      gridSource: 'predicted',
    });

    const upload = await task.planSteps({
      run: {
        kind: 'upload',
        audioFile: new ArrayBuffer(8),
        fileName: 'song.mp3',
      },
    });
    const resume = await task.planSteps({
      run: {kind: 'resume', projectId: 'proj-labels'},
    });

    for (const shared of ['separating', 'tempo-mapping', 'transcribing']) {
      expect(step(upload, shared).label).toBe(step(resume, shared).label);
    }
  });
});
