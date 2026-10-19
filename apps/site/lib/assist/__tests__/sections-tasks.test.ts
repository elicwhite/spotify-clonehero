/**
 * The two assist tasks either side of the sections/tempo split (plan 0076
 * item 23), pinned at the request they send the shared pipeline worker.
 *
 * The split is only real if the REQUEST says so: a tempo-map run that still
 * asked for section labels would still spend the LinkSeg model download and
 * still hand its host a set of titles to overwrite the chart's with.
 */

jest.mock('../../tempo-map/pipeline-client', () => ({
  runTempoPipeline: jest.fn(),
  runTempoPipelineFromPcm: jest.fn(),
  defaultCreateWorker: jest.fn(),
}));

jest.mock('../../audio-pipeline/decode-audio', () => ({
  decodeAndResampleTo44k: jest.fn(),
}));

jest.mock('../../audio-pipeline/stem-cache', () => ({
  ...jest.requireActual('../../audio-pipeline/stem-cache'),
  hasStem: jest.fn(async () => true),
}));

jest.mock('../../drum-transcription/pipeline/tempo-track', () => ({
  runTempoTrack: jest.fn(),
}));

jest.mock('../../lyrics-align/model-cache', () => ({
  ...jest.requireActual('../../lyrics-align/model-cache'),
  hasCachedModel: jest.fn(async () => false),
}));

import {
  runTempoPipeline,
  runTempoPipelineFromPcm,
} from '@/lib/tempo-map/pipeline-client';
import {runTempoTrack} from '@/lib/drum-transcription/pipeline/tempo-track';
import {hasCachedModel} from '@/lib/lyrics-align/model-cache';
import {BEAT_THIS_CACHE_KEY, BEAT_THIS_MIN_BYTES} from '@/lib/tempo-map/models';
import type {LinkSegSections} from '@/lib/tempo-map/types';

import {makeGenerateSectionsTask} from '../tasks/generate-sections';
import {makeGenerateTempoMapTask} from '../tasks/generate-tempo-map';
import type {AssistAudio} from '../tasks/types';

const mockRunTempoPipeline = runTempoPipeline as jest.Mock;
const mockRunTempoPipelineFromPcm = runTempoPipelineFromPcm as jest.Mock;
const mockRunTempoTrack = runTempoTrack as jest.Mock;
const mockHasCachedModel = hasCachedModel as jest.Mock;

const DECODED = {
  length: 256,
  duration: 4,
  sampleRate: 44100,
  numberOfChannels: 2,
  getChannelData: () => new Float32Array(256),
} as unknown as AudioBuffer;

const AUDIO: AssistAudio = {
  loadOriginalBytes: async () => new Uint8Array(8),
  stemFingerprint: 'fp',
  loadDecodedMix: async () => DECODED,
};

const SECTIONS: LinkSegSections = {
  times: [0, 10, 20],
  labels: ['Intro', 'Chorus'],
};

const noProgress = () => {};

beforeEach(() => {
  mockRunTempoPipeline.mockReset();
  mockRunTempoPipelineFromPcm.mockReset();
  mockRunTempoTrack.mockReset();
  mockHasCachedModel.mockReset().mockResolvedValue(false);
});

// A second run reads Beat This! out of the OPFS model cache and downloads
// nothing, so the step has to report itself the way any other already-done
// work does rather than flashing "Downloading" every single run.
describe.each([
  ['generate-tempo-map', makeGenerateTempoMapTask],
  ['generate-sections', makeGenerateSectionsTask],
] as const)('%s beat-model step', (_name, makeTask) => {
  it('plans the beat-model download as cached once the model is in OPFS', async () => {
    mockHasCachedModel.mockResolvedValue(true);
    const steps = await makeTask().planSteps({audio: AUDIO});
    expect(steps.find(s => s.key === 'download-beat-model')?.cached).toBe(true);
    expect(mockHasCachedModel).toHaveBeenCalledWith(
      BEAT_THIS_CACHE_KEY,
      BEAT_THIS_MIN_BYTES,
    );
  });

  it('plans it as real work when the model is not cached yet', async () => {
    mockHasCachedModel.mockResolvedValue(false);
    const steps = await makeTask().planSteps({audio: AUDIO});
    expect(steps.find(s => s.key === 'download-beat-model')?.cached).toBe(
      false,
    );
  });
});

describe('generate-tempo-map', () => {
  beforeEach(() => {
    mockRunTempoTrack.mockResolvedValue({
      synctrack: {origin_ms: 0, tempos: [], timeSignatures: []},
      rawSynctrack: {origin_ms: 0, tempos: [], timeSignatures: []},
      events: [],
      durationSeconds: 4,
      sections: null,
      meterStats: null,
      drumOnsetOffsetMs: null,
      drumStemStereo: null,
    });
  });

  it('asks the pipeline NOT to label sections', async () => {
    await makeGenerateTempoMapTask().run(
      {audio: AUDIO},
      new AbortController().signal,
      noProgress,
    );
    expect(mockRunTempoTrack).toHaveBeenCalledTimes(1);
    expect(mockRunTempoTrack.mock.calls[0][1]).toMatchObject({sections: false});
  });

  it('plans no section-labeling step', async () => {
    const steps = await makeGenerateTempoMapTask().planSteps({audio: AUDIO});
    expect(steps.map(s => s.key)).not.toContain('sections');
  });

  it('shows the drum-onset alignment as part of building the tempo map', async () => {
    const steps = await makeGenerateTempoMapTask().planSteps({audio: AUDIO});
    expect(steps.map(s => s.key)).not.toContain('transcribe-drums');
    const step = steps.find(s => s.key === 'convert');
    expect(step?.label).toBe('Building the tempo map');
    // The description has to justify the wait: why this stage makes the map
    // better, not just that a model is running.
    expect(step?.description).toMatch(/grid/i);
  });

  it('reports the alignment pass as progress on the tempo-map step', async () => {
    const seen: Array<{
      activeKey: string | null;
      progress: number | undefined;
    }> = [];
    mockRunTempoTrack.mockImplementation(async (_buffer, options) => {
      options.onProgress({stage: 'convert'});
      options.onProgress({stage: 'transcribe-drums', percent: 0.5});
      return {
        synctrack: {origin_ms: 0, tempos: [], timeSignatures: []},
        rawSynctrack: {origin_ms: 0, tempos: [], timeSignatures: []},
        events: [],
        durationSeconds: 4,
        sections: null,
        meterStats: null,
        drumOnsetOffsetMs: null,
        drumStemStereo: null,
      };
    });
    await makeGenerateTempoMapTask().run(
      {audio: AUDIO},
      new AbortController().signal,
      event =>
        seen.push({activeKey: event.activeKey, progress: event.progress}),
    );
    expect(seen).toEqual([
      {activeKey: 'convert', progress: 0},
      {activeKey: 'convert', progress: 0.5},
      {activeKey: null, progress: undefined},
    ]);
  });
});

describe('generate-sections', () => {
  beforeEach(() => {
    mockRunTempoPipeline.mockResolvedValue({
      kind: 'sections',
      sections: SECTIONS,
      fullMixBeatCount: 100,
      meterStats: null,
    });
  });

  it('runs the sections half alone, with no tempo map', async () => {
    await makeGenerateSectionsTask().run(
      {audio: AUDIO},
      new AbortController().signal,
      noProgress,
    );
    expect(mockRunTempoPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunTempoPipeline.mock.calls[0][1].kind).toBe('sections');
  });

  it('returns the labels the pipeline produced', async () => {
    const result = await makeGenerateSectionsTask().run(
      {audio: AUDIO},
      new AbortController().signal,
      noProgress,
    );
    expect(result.sections).toEqual(SECTIONS);
  });

  it('surfaces a song with no detectable structure as null rather than throwing', async () => {
    mockRunTempoPipeline.mockResolvedValue({
      synctrack: null,
      sections: null,
      drumOnsetOffsetMs: null,
      fullMixBeatCount: 0,
      drumStemBeatCount: 0,
      meterStats: null,
      drumStemStereo: null,
    });
    const result = await makeGenerateSectionsTask().run(
      {audio: AUDIO},
      new AbortController().signal,
      noProgress,
    );
    expect(result.sections).toBeNull();
  });

  it('plans no separation work: a sections run never needs a drum stem', async () => {
    const steps = await makeGenerateSectionsTask().planSteps({audio: AUDIO});
    expect(steps.map(s => s.key)).toEqual([
      'download-beat-model',
      'beats-fullmix',
      'sections',
    ]);
  });

  // A chart that already has a grid hands it over, and then the run must
  // really skip beat detection: the whole point is dropping the 83 MB model
  // download and the ~10 s pass, which only happens if the request carries
  // the beats.
  describe('with a caller-supplied beat grid', () => {
    const deriveBeatTimes = (durationSeconds: number) =>
      Array.from({length: durationSeconds * 2}, (_unused, i) => i * 0.5);

    it('sends the chart beats, derived over the decoded duration', async () => {
      await makeGenerateSectionsTask().run(
        {audio: AUDIO, deriveBeatTimes},
        new AbortController().signal,
        noProgress,
      );
      // DECODED.duration is 4 s.
      expect(mockRunTempoPipeline.mock.calls[0][1].beatTimes).toEqual([
        0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5,
      ]);
    });

    it('plans only the labeling step: no beat model, no beat pass', async () => {
      const steps = await makeGenerateSectionsTask().planSteps({
        audio: AUDIO,
        deriveBeatTimes,
      });
      expect(steps.map(s => s.key)).toEqual(['sections']);
    });

    it('still detects beats when no grid is offered', async () => {
      await makeGenerateSectionsTask().run(
        {audio: AUDIO},
        new AbortController().signal,
        noProgress,
      );
      expect(mockRunTempoPipeline.mock.calls[0][1].beatTimes).toBeNull();
    });
  });

  it('reports each stage the pipeline emits', async () => {
    const seen: Array<string | null> = [];
    mockRunTempoPipeline.mockImplementation(async (_buffer, options) => {
      options.onProgress({stage: 'beats-fullmix', percent: 0.5});
      options.onProgress({stage: 'sections', percent: 1});
      return {
        synctrack: null,
        sections: SECTIONS,
        drumOnsetOffsetMs: null,
        fullMixBeatCount: 1,
        drumStemBeatCount: 0,
        meterStats: null,
        drumStemStereo: null,
      };
    });
    await makeGenerateSectionsTask().run(
      {audio: AUDIO},
      new AbortController().signal,
      event => seen.push(event.activeKey),
    );
    expect(seen).toEqual(['beats-fullmix', 'sections', null]);
  });
});
