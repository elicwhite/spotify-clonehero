/**
 * Decoded-onset retention tests (plan 0061 §3a / §5).
 *
 * Covers the DecodedOnsetsFile build/load round trip and, via a mocked OPFS
 * layer, all three runner write sites (runPipeline, runPipelineFromChart,
 * resumePipeline — the third catches the silent-degradation bug where a
 * resumed-but-transcribed project would wrongly read as "never transcribed"),
 * plus regenerateProject invalidation through REGENERATED_ARTIFACT_FILES.
 */

import {createEmptyChart} from '@/lib/chart-edit';
import type {RawDrumEvent, TranscriptionResult} from '../ml/types';
import type {DrumTranscriber} from '../ml/transcriber';
import {
  buildDecodedOnsetsFile,
  loadDecodedOnsets,
  DECODED_ONSETS_FILE,
} from './decoded-onsets';
import {
  runPipeline,
  runPipelineFromChart,
  resumePipeline,
  regenerateProject,
  REGENERATED_ARTIFACT_FILES,
} from './runner';
import * as opfs from '../storage/opfs';

jest.mock('../storage/opfs', () => {
  const files = new Map<string, unknown>();
  const projects = new Map<string, Record<string, unknown>>();
  const key = (projectId: string, fileName: string) =>
    `${projectId}/${fileName}`;
  let nextId = 1;
  return {
    __esModule: true,
    __files: files,
    __projects: projects,
    __reset: () => {
      files.clear();
      projects.clear();
      nextId = 1;
    },
    CHART_FILE_BASENAMES: {chart: 'notes.chart', mid: 'notes.mid'},
    editedVariant: (baseName: string) => {
      const dot = baseName.lastIndexOf('.');
      return `${baseName.slice(0, dot)}.edited${baseName.slice(dot)}`;
    },
    createProject: jest.fn(async (name: string) => {
      const id = `project-${nextId++}`;
      const meta = {
        id,
        name,
        createdAt: '',
        updatedAt: '',
        durationSeconds: null,
        stage: 'uploaded',
      };
      projects.set(id, meta);
      return meta;
    }),
    getProject: jest.fn(async (id: string) => {
      const meta = projects.get(id);
      if (!meta) throw new Error(`no project ${id}`);
      return meta;
    }),
    updateProject: jest.fn(
      async (id: string, patch: Record<string, unknown>) => {
        projects.set(id, {...projects.get(id), ...patch});
      },
    ),
    storeAudioOpus: jest.fn(async (id: string) => {
      files.set(key(id, 'audio.pcm'), new Uint8Array(0));
    }),
    hasStoredAudio: jest.fn(async (id: string) =>
      files.has(key(id, 'audio.pcm')),
    ),
    loadFullMixPcm: jest.fn(async () => new Float32Array(512)),
    writeProjectBinary: jest.fn(
      async (id: string, name: string, data: unknown) => {
        files.set(key(id, name), data);
      },
    ),
    writeProjectJSON: jest.fn(
      async (id: string, name: string, data: unknown) => {
        files.set(key(id, name), JSON.stringify(data));
      },
    ),
    readProjectJSON: jest.fn(async (id: string, name: string) => {
      const raw = files.get(key(id, name));
      if (typeof raw !== 'string') throw new Error(`missing ${name}`);
      return JSON.parse(raw);
    }),
    projectFileExists: jest.fn(async (id: string, name: string) =>
      files.has(key(id, name)),
    ),
    hasProjectChartFile: jest.fn(async (id: string) =>
      [
        'notes.chart',
        'notes.mid',
        'notes.edited.chart',
        'notes.edited.mid',
      ].some(n => files.has(key(id, n))),
    ),
    writePackageInfo: jest.fn(async () => {}),
    writeProjectAssets: jest.fn(async () => {}),
    deleteProjectFile: jest.fn(async (id: string, name: string) => {
      files.delete(key(id, name));
    }),
  };
});

jest.mock('../ml/roformer-separation', () => ({
  separateDrums: jest.fn(async () => {}),
  hasDrumStem: jest.fn(async () => true),
  loadDrumStem: jest.fn(async () => new Float32Array(512)),
}));

// Tempo mapping is out of scope here: rejecting makes ensureSynctrack fall
// back to the flat-tempo chart path, which is all these tests need.
jest.mock('../../tempo-map/pipeline-client', () => ({
  runTempoPipelineFromPcm: jest.fn(async () => {
    throw new Error('tempo pipeline unavailable in tests');
  }),
}));

jest.mock('../audio/decoder', () => ({
  decodeAudio: jest.fn(async () => ({
    duration: 4,
    sampleRate: 44100,
    length: 4 * 44100,
    numberOfChannels: 2,
  })),
  interleaveAudioBuffer: jest.fn(() => new Float32Array(1024)),
}));

// The upload path Opus-encodes the decoded PCM for storage; jsdom has no
// WebCodecs, so this is stubbed like the other audio IO above.
jest.mock('../../audio/opus-encoder', () => ({
  encodePcmToOpus: jest.fn(
    async () => new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
  ),
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

interface MockOpfs {
  __files: Map<string, unknown>;
  __reset: () => void;
  deleteProjectFile: jest.Mock;
}
const mockOpfs = opfs as unknown as MockOpfs;

const EVENTS: RawDrumEvent[] = [
  {timeSeconds: 0.5, drumClass: 'BD', midiPitch: 36, confidence: 0.91},
  {timeSeconds: 1.0, drumClass: 'SD', midiPitch: 38, confidence: 0.72},
  {timeSeconds: 1.5, drumClass: 'HH', midiPitch: 42, confidence: 0.33},
];

function fakeTranscriber(events: RawDrumEvent[] = EVENTS): DrumTranscriber {
  return {
    transcribe: async (): Promise<TranscriptionResult> => ({
      events,
      modelOutput: {
        predictions: new Float32Array(0),
        nFrames: 0,
        nClasses: 9,
      },
      durationSeconds: 4,
    }),
  };
}

function storedJson(projectId: string, fileName: string): string | undefined {
  const raw = mockOpfs.__files.get(`${projectId}/${fileName}`);
  return typeof raw === 'string' ? raw : undefined;
}

beforeEach(() => {
  mockOpfs.__reset();
  jest.clearAllMocks();
  // The mocked tempo pipeline rejects by design (flat-tempo fallback);
  // silence the runner's expected fallback warning.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('buildDecodedOnsetsFile', () => {
  it('builds a version-1 file with explicitly picked onset fields', () => {
    const withExtra = EVENTS.map(e => ({...e, extraneous: true}));
    const file = buildDecodedOnsetsFile(withExtra, 'audio');
    expect(file).toEqual({version: 1, flow: 'audio', onsets: EVENTS});
    // Unknown RawDrumEvent additions never leak into the persisted schema.
    expect(file.onsets[0]).not.toHaveProperty('extraneous');
  });

  it('preserves onset order and carries the chart flow tag', () => {
    const file = buildDecodedOnsetsFile(EVENTS, 'chart');
    expect(file.flow).toBe('chart');
    expect(file.onsets.map(o => o.timeSeconds)).toEqual([0.5, 1.0, 1.5]);
  });
});

describe('loadDecodedOnsets', () => {
  it('returns null when the file does not exist (never-transcribed project)', async () => {
    await expect(loadDecodedOnsets('project-none')).resolves.toBeNull();
  });

  it('round-trips a persisted file byte-identically', async () => {
    const file = buildDecodedOnsetsFile(EVENTS, 'audio');
    await opfs.writeProjectJSON('p1', DECODED_ONSETS_FILE, file);
    expect(storedJson('p1', DECODED_ONSETS_FILE)).toBe(JSON.stringify(file));
    await expect(loadDecodedOnsets('p1')).resolves.toEqual(file);
  });

  it('discards a file with an unknown schema version', async () => {
    await opfs.writeProjectJSON('p1', DECODED_ONSETS_FILE, {
      version: 2,
      flow: 'audio',
      onsets: [],
    });
    await expect(loadDecodedOnsets('p1')).resolves.toBeNull();
  });

  it('discards a file with an invalid flow or malformed shape', async () => {
    await opfs.writeProjectJSON('p1', DECODED_ONSETS_FILE, {
      version: 1,
      flow: 'midi',
      onsets: [],
    });
    await expect(loadDecodedOnsets('p1')).resolves.toBeNull();

    await opfs.writeProjectJSON('p1', DECODED_ONSETS_FILE, {
      version: 1,
      flow: 'audio',
      onsets: 'not-an-array',
    });
    await expect(loadDecodedOnsets('p1')).resolves.toBeNull();

    mockOpfs.__files.set(`p1/${DECODED_ONSETS_FILE}`, 'not json {');
    await expect(loadDecodedOnsets('p1')).resolves.toBeNull();
  });
});

describe('runner write sites', () => {
  const noProgress = () => {};

  it('runPipeline persists decoded onsets with flow audio, byte-identical to the built file', async () => {
    const projectId = await runPipeline(
      new ArrayBuffer(16),
      'song.mp3',
      noProgress,
      fakeTranscriber(),
    );

    const expected = buildDecodedOnsetsFile(EVENTS, 'audio');
    expect(storedJson(projectId, DECODED_ONSETS_FILE)).toBe(
      JSON.stringify(expected),
    );
    await expect(loadDecodedOnsets(projectId)).resolves.toEqual(expected);
    // Written alongside confidence.json, before the chart file exists check
    // could pass without it.
    expect(storedJson(projectId, 'confidence.json')).toBeDefined();
  });

  it('runPipelineFromChart persists decoded onsets with flow chart', async () => {
    const projectId = await runPipelineFromChart(
      {
        chartDoc: {
          parsedChart: createEmptyChart({
            format: 'chart',
            resolution: 480,
            bpm: 150,
            timeSignature: {numerator: 4, denominator: 4},
          }),
          assets: [],
        },
        audioFile: new File([new ArrayBuffer(16)], 'song.mp3', {
          type: 'audio/mpeg',
        }),
        packageInfo: {sourceFormat: 'folder', originalName: 'song'},
        extraAssets: [],
      },
      noProgress,
      fakeTranscriber(),
    );

    const expected = buildDecodedOnsetsFile(EVENTS, 'chart');
    await expect(loadDecodedOnsets(projectId)).resolves.toEqual(expected);
  });

  it('resumePipeline own transcription path persists the artifact (silent-degradation guard)', async () => {
    // A project interrupted after audio storage but before transcription:
    // audio present, no chart, no decoded onsets.
    const meta = await opfs.createProject('resumed');
    await opfs.storeAudioOpus(
      meta.id,
      new Uint8Array(0),
      {} as never,
      0 as never,
    );
    expect(await loadDecodedOnsets(meta.id)).toBeNull();

    await resumePipeline(meta.id, noProgress, fakeTranscriber());

    const expected = buildDecodedOnsetsFile(EVENTS, 'audio');
    await expect(loadDecodedOnsets(meta.id)).resolves.toEqual(expected);
  });

  it('regenerateProject invalidates decoded onsets along with the other derived artifacts', async () => {
    expect(REGENERATED_ARTIFACT_FILES).toContain(DECODED_ONSETS_FILE);

    const meta = await opfs.createProject('regen');
    await opfs.storeAudioOpus(
      meta.id,
      new Uint8Array(0),
      {} as never,
      0 as never,
    );
    // Simulate a fully transcribed project whose onsets would go stale.
    const stale = buildDecodedOnsetsFile(
      [{timeSeconds: 9, drumClass: 'RD', midiPitch: 51, confidence: 0.1}],
      'audio',
    );
    await opfs.writeProjectJSON(meta.id, DECODED_ONSETS_FILE, stale);
    await opfs.writeProjectBinary(meta.id, 'notes.chart', new Uint8Array(1));
    await opfs.writeProjectJSON(meta.id, 'confidence.json', {notes: {}});

    await regenerateProject(meta.id, noProgress, fakeTranscriber());

    // The stale artifact was deleted before resume...
    expect(mockOpfs.deleteProjectFile.mock.calls).toContainEqual([
      meta.id,
      DECODED_ONSETS_FILE,
    ]);
    // ...and the resumed transcription rewrote a fresh one.
    const expected = buildDecodedOnsetsFile(EVENTS, 'audio');
    await expect(loadDecodedOnsets(meta.id)).resolves.toEqual(expected);
  });
});
