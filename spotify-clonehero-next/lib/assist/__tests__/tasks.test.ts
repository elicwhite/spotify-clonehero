/**
 * lib/assist/tasks/ tests (plan 0074 Phase 1, Suite 1).
 *
 * `regenerateProject`, `hasDrumStem`, `decodeAndResampleTo44k`,
 * `resampleTo16kMono`, and `alignVocals` are mocked module boundaries —
 * runner.ts's internals, ONNX-worker-backed transcription, and real audio
 * decode are exercised by their own suites. `stem-cache.ts` and
 * `demucs-client.ts` are used for real (backed by `fake-opfs.ts` / a
 * `FakeWorker`) so the cache-routing and cancellation behavior under test
 * is genuine, not asserted against a mock's own bookkeeping.
 */

import {readFileSync} from 'fs';
import path from 'path';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import {finalizeSynctrack} from '@/lib/tempo-map/finalize-synctrack';
import type {Synctrack} from '@/lib/tempo-map/types';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote, writeChartFolder} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {
  createProject,
  updateProject,
  writeProjectBinary,
  writeProjectJSON,
} from '@/lib/drum-transcription/storage/opfs';
import {
  computeStemFingerprint,
  ROFORMER_SEPARATOR_ID,
  storeStem,
  storeStemOpus,
} from '@/lib/audio-pipeline/stem-cache';

// jest.mock's first argument is a bare string Jest resolves directly (SWC
// only rewrites the `@/...` alias inside real `import` specifiers), so the
// mock registrations below use relative paths to the same files the `@/...`
// imports below resolve to.
jest.mock('../../drum-transcription/pipeline/runner', () => ({
  regenerateProject: jest.fn(),
}));
jest.mock('../../drum-transcription/ml/roformer-separation', () => ({
  hasDrumStem: jest.fn(),
}));
jest.mock('../../audio-pipeline/decode-audio', () => ({
  decodeAndResampleTo44k: jest.fn(),
}));
jest.mock('../../audio-pipeline/lyrics-audio', () => ({
  resampleTo16kMono: jest.fn(),
}));
jest.mock('../../lyrics-align/aligner', () => ({
  alignVocals: jest.fn(),
}));
// Resampling the separated stem to the CRNN's rate pulls a wasm resampler
// over the network; the rate conversion itself is not what these tests are
// about.
jest.mock('../../drum-transcription/pipeline/crnn-audio-prep', () => ({
  planarStereoToCrnnInput: jest.fn(async () => new Float32Array(8)),
}));

import {regenerateProject} from '@/lib/drum-transcription/pipeline/runner';
import {hasDrumStem} from '@/lib/drum-transcription/ml/roformer-separation';
import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {resampleTo16kMono} from '@/lib/audio-pipeline/lyrics-audio';
import {alignVocals} from '@/lib/lyrics-align/aligner';

import {transcribeDrumsTask} from '../tasks/transcribe-drums';
import {
  addLyricsTask,
  makeAddLyricsTask,
  type AddLyricsInput,
} from '../tasks/add-lyrics';
import {makeGenerateTempoMapTask} from '../tasks/generate-tempo-map';
import type {StepProgressEvent} from '../run-to-steps';
import type {DrumTranscriber} from '@/lib/drum-transcription/ml/transcriber';

const mockRegenerateProject = regenerateProject as jest.Mock;
const mockHasDrumStem = hasDrumStem as jest.Mock;
const mockDecode = decodeAndResampleTo44k as jest.Mock;
const mockResample = resampleTo16kMono as jest.Mock;
const mockAlignVocals = alignVocals as jest.Mock;

installFakeOPFS();

// `transcribeDrumsTask` waits for the page's ONNX Runtime <Script> before
// starting a run. The runtime itself is never used here (the pipeline is
// mocked), so stand in for it.
(globalThis as {ort?: unknown}).ort = {};

/** Polls `predicate` across macrotask ticks until it's true, instead of
 *  assuming a fixed number of ticks is always enough. The await chain ahead
 *  of `createDemucsWorker()` (computeStemFingerprint's real WebCrypto call,
 *  then hasStemOpus, then the mocked decodeAndResampleTo44k) can take more
 *  than one tick to settle under CPU contention, so a single `setTimeout(r,
 *  0)` flush is timing-fragile; this keeps yielding until the condition
 *  holds or the timeout is exceeded. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: condition did not become true in time');
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/** A controllable fake worker responding to the demucs-worker.ts protocol
 *  (same shape as lib/lyrics-align/__tests__/demucs-worker-client.test.ts). */
class FakeWorker {
  onmessage: ((e: {data: any}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: any[] = [];
  terminated = false;

  postMessage(msg: any) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: any) {
    this.onmessage?.({data: msg});
  }
}

function fakeAudioBuffer(): AudioBuffer {
  return {
    length: 2,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([0, 0]),
  } as unknown as AudioBuffer;
}

function buildChartBytesWithDrumNotes(): Uint8Array {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  addDrumNote(doc.parsedChart.trackData[0], {
    tick: 480,
    type: noteTypes.redDrum,
  });
  const files = writeChartFolder(doc);
  const chartFile = files.find(f => f.fileName === 'notes.chart');
  if (!chartFile) throw new Error('fixture: no chart file produced');
  return chartFile.data;
}

describe('transcribeDrumsTask', () => {
  beforeEach(() => {
    mockRegenerateProject.mockReset();
    mockHasDrumStem.mockReset();
  });

  it('planSteps marks "separating" cached when a drum stem already exists', async () => {
    mockHasDrumStem.mockResolvedValue(true);
    const project = await createProject('song');
    const steps = await transcribeDrumsTask.planSteps({
      run: {kind: 'regenerate', projectId: project.id},
    });
    expect(steps.find(s => s.key === 'separating')?.cached).toBe(true);
    expect(steps.find(s => s.key === 'tempo-mapping')?.cached).toBe(false);
  });

  it('planSteps marks "separating" uncached on a miss', async () => {
    mockHasDrumStem.mockResolvedValue(false);
    const project = await createProject('song');
    const steps = await transcribeDrumsTask.planSteps({
      run: {kind: 'regenerate', projectId: project.id},
    });
    expect(steps.find(s => s.key === 'separating')?.cached).toBe(false);
  });

  it('planSteps leaves "tempo-mapping" uncached even for a provided-grid project (regenerateProject refuses those runs outright)', async () => {
    mockHasDrumStem.mockResolvedValue(false);
    const project = await createProject('song');
    await updateProject(project.id, {gridSource: 'provided'});

    const steps = await transcribeDrumsTask.planSteps({
      run: {kind: 'regenerate', projectId: project.id},
    });
    expect(steps.find(s => s.key === 'tempo-mapping')?.cached).toBe(false);
  });

  it('planSteps leaves "tempo-mapping" uncached for a regenerate run even with a persisted map', async () => {
    mockHasDrumStem.mockResolvedValue(false);
    const project = await createProject('song');
    await writeProjectJSON(project.id, 'synctrack.json', {
      synctrack: {origin_ms: 0, tempos: [{ms: 0, bpm: 120}]},
    });

    const steps = await transcribeDrumsTask.planSteps({
      run: {kind: 'regenerate', projectId: project.id},
    });
    expect(steps.find(s => s.key === 'tempo-mapping')?.cached).toBe(false);
  });

  it('maps pipeline progress monotonically and returns the regenerated drum notes on success', async () => {
    const project = await createProject('song');
    await writeProjectBinary(
      project.id,
      'notes.chart',
      buildChartBytesWithDrumNotes(),
    );

    mockRegenerateProject.mockImplementation(
      async (_projectId: string, onProgress: (p: unknown) => void) => {
        onProgress({step: 'separating', progress: 0});
        onProgress({step: 'separating', progress: 1});
        onProgress({step: 'tempo-mapping', progress: 0});
        onProgress({step: 'tempo-mapping', progress: 1});
        onProgress({step: 'transcribing', progress: 0});
        onProgress({step: 'transcribing', progress: 1});
        onProgress({step: 'ready', progress: 1});
        return project.id;
      },
    );

    const events: StepProgressEvent[] = [];
    const controller = new AbortController();
    const result = await transcribeDrumsTask.run(
      {run: {kind: 'regenerate', projectId: project.id}},
      controller.signal,
      e => events.push(e),
    );

    const order = ['separating', 'tempo-mapping', 'transcribing'];
    const seenIndices = events
      .filter(e => e.activeKey !== null)
      .map(e => order.indexOf(e.activeKey as string));
    for (let i = 1; i < seenIndices.length; i++) {
      expect(seenIndices[i]).toBeGreaterThanOrEqual(seenIndices[i - 1]);
    }
    expect(events.at(-1)).toEqual({activeKey: null, terminal: 'done'});

    expect(result.notes.map(n => n.tick)).toEqual([0, 480]);
  });

  it('propagates a real pipeline error (not AbortError)', async () => {
    const project = await createProject('song');
    mockRegenerateProject.mockRejectedValue(new Error('boom'));

    const controller = new AbortController();
    await expect(
      transcribeDrumsTask.run(
        {run: {kind: 'regenerate', projectId: project.id}},
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow('boom');
  });

  it('rejects with AbortError on cancel and applies nothing', async () => {
    const project = await createProject('song');
    // Stands in for `regenerateProject`'s own cancellation contract: it
    // terminates its workers on abort and rejects with an AbortError. The
    // task delegates to that rather than racing it.
    mockRegenerateProject.mockImplementation(
      (
        _projectId: string,
        onProgress: (p: unknown) => void,
        _existingChart: unknown,
        opts: {signal: AbortSignal},
      ) =>
        new Promise<string>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (opts.signal.aborted) return abort();
          onProgress({step: 'separating', progress: 0});
          opts.signal.addEventListener('abort', abort);
        }),
    );

    const controller = new AbortController();
    const runPromise = transcribeDrumsTask.run(
      {run: {kind: 'regenerate', projectId: project.id}},
      controller.signal,
      () => {},
    );
    controller.abort();

    await expect(runPromise).rejects.toMatchObject({name: 'AbortError'});
  });
});

describe('addLyricsTask', () => {
  beforeEach(() => {
    mockDecode.mockReset();
    mockResample.mockReset();
    mockAlignVocals.mockReset();
  });

  it('planSteps marks "separate" cached when the roformer vocals stem is already cached', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fingerprint = await computeStemFingerprint(
      bytes,
      ROFORMER_SEPARATOR_ID,
    );
    await storeStemOpus(fingerprint, 'vocals', new Uint8Array([9, 9, 9]));

    const steps = await addLyricsTask.planSteps({
      lyrics: 'la la',
      vocals: {kind: 'resolve', audio: {loadOriginalBytes: async () => bytes}},
    });
    expect(steps.find(s => s.key === 'separate')?.cached).toBe(true);
  });

  it('planSteps marks "separate" uncached on a miss', async () => {
    const bytes = new Uint8Array([2, 2, 2, 2]);
    const steps = await addLyricsTask.planSteps({
      lyrics: 'la la',
      vocals: {kind: 'resolve', audio: {loadOriginalBytes: async () => bytes}},
    });
    expect(steps.find(s => s.key === 'separate')?.cached).toBe(false);
  });

  it('cache hit resolves via the cached vocals stem and never spawns Demucs', async () => {
    const bytes = new Uint8Array([5, 6, 7, 8]);
    const fingerprint = await computeStemFingerprint(
      bytes,
      ROFORMER_SEPARATOR_ID,
    );
    const opusBytes = new Uint8Array([1, 2, 3]);
    await storeStemOpus(fingerprint, 'vocals', opusBytes);

    mockResample.mockResolvedValue(new Float32Array([0.1, 0.2]));
    mockAlignVocals.mockResolvedValue({
      lines: [],
      words: [],
      syllables: [
        {text: 'la', startMs: 0, endMs: 100, joinNext: false, newLine: true},
      ],
      durationMs: 100,
      lowConfidenceFrac: 0,
      lowConfidence: false,
    });

    let spawned = false;
    const events: StepProgressEvent[] = [];
    const controller = new AbortController();
    const task = makeAddLyricsTask({
      createDemucsWorker: () => {
        spawned = true;
        return {} as Worker;
      },
    });
    const result = await task.run(
      {
        lyrics: 'la la',
        vocals: {
          kind: 'resolve',
          audio: {loadOriginalBytes: async () => bytes},
        },
      },
      controller.signal,
      e => events.push(e),
    );

    expect(spawned).toBe(false);
    expect(mockResample).toHaveBeenCalledWith(opusBytes, 'audio/opus');
    expect(result.syllables).toHaveLength(1);

    const order = ['separate', 'load', 'syllabify', 'align'];
    const seenIndices = events
      .filter(e => e.activeKey !== null)
      .map(e => order.indexOf(e.activeKey as string));
    for (let i = 1; i < seenIndices.length; i++) {
      expect(seenIndices[i]).toBeGreaterThanOrEqual(seenIndices[i - 1]);
    }
    expect(events.at(-1)).toEqual({activeKey: null, terminal: 'done'});
  });

  it('probes the caller-supplied fingerprint verbatim instead of re-hashing the audio bytes', async () => {
    // The persisted fingerprint an OPFS project's stems were stored under,
    // which no longer re-derives from the bytes the caller can reach.
    const persistedFingerprint = 'persisted-fingerprint-from-project-meta';
    const opusBytes = new Uint8Array([4, 5, 6]);
    await storeStemOpus(persistedFingerprint, 'vocals', opusBytes);

    mockResample.mockResolvedValue(new Float32Array([0.1]));
    mockAlignVocals.mockResolvedValue({
      lines: [],
      words: [],
      syllables: [],
      durationMs: 0,
      lowConfidenceFrac: 0,
      lowConfidence: false,
    });

    let bytesRead = 0;
    const input: AddLyricsInput = {
      lyrics: 'la la',
      vocals: {
        kind: 'resolve',
        audio: {
          stemFingerprint: persistedFingerprint,
          loadOriginalBytes: async () => {
            bytesRead += 1;
            return new Uint8Array([99, 99, 99]);
          },
        },
      },
    };
    const task = makeAddLyricsTask({
      createDemucsWorker: () => {
        throw new Error('Demucs must not run on a cache hit');
      },
    });

    const steps = await task.planSteps(input);
    expect(steps.find(s => s.key === 'separate')?.cached).toBe(true);

    const controller = new AbortController();
    const result = await task.run(input, controller.signal, () => {});

    expect(mockResample).toHaveBeenCalledWith(opusBytes, 'audio/opus');
    expect(result.vocalsSource).toBe('cache');
    // A cache hit never reads (or re-hashes) the audio file.
    expect(bytesRead).toBe(0);
  });

  it('cache miss spawns Demucs via the injected createDemucsWorker factory', async () => {
    const bytes = new Uint8Array([10, 11, 12, 13]);
    mockDecode.mockResolvedValue(fakeAudioBuffer());
    // The real `alignVocals` posts the stem into its worker with the buffer
    // in the transfer list, which detaches the caller's view. Reproduce that
    // here so the result's stem is only non-empty if the task copied it
    // before aligning.
    mockAlignVocals.mockImplementation(async (pcm: Float32Array) => {
      structuredClone(pcm, {transfer: [pcm.buffer]});
      return {
        lines: [],
        words: [],
        syllables: [],
        durationMs: 0,
        lowConfidenceFrac: 0,
        lowConfidence: false,
      };
    });

    let fake: FakeWorker | undefined;
    const controller = new AbortController();
    const task = makeAddLyricsTask({
      createDemucsWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    });
    const runPromise = task.run(
      {
        lyrics: 'la la',
        vocals: {
          kind: 'resolve',
          audio: {loadOriginalBytes: async () => bytes},
        },
      },
      controller.signal,
      () => {},
    );

    await waitFor(() => fake !== undefined);
    expect(fake!.posted).toEqual([{type: 'load'}]);
    fake!.emit({type: 'loaded'});
    expect(fake!.posted[1]?.type).toBe('separate');

    const vocals16k = new Float32Array([0.3, 0.4]);
    fake!.emit({type: 'result', vocals16k});

    const result = await runPromise;
    expect(fake!.terminated).toBe(true);
    expect(mockResample).not.toHaveBeenCalled();
    expect(result.syllables).toEqual([]);
    expect(result.vocalsSource).toBe('demucs');
    // The returned stem stays readable after `alignVocals` transferred the
    // separated buffer into its worker (which detaches `vocals16k` itself) —
    // hosts render a waveform from it.
    expect(vocals16k.length).toBe(0);
    expect(Array.from(result.vocals16k)).toEqual([
      expect.closeTo(0.3, 5),
      expect.closeTo(0.4, 5),
    ]);
  });

  it('cancels the Demucs branch immediately, terminating the worker and applying nothing', async () => {
    const bytes = new Uint8Array([20, 21, 22, 23]);
    mockDecode.mockResolvedValue(fakeAudioBuffer());

    let fake: FakeWorker | undefined;
    const controller = new AbortController();
    const task = makeAddLyricsTask({
      createDemucsWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    });
    const runPromise = task.run(
      {
        lyrics: 'la la',
        vocals: {
          kind: 'resolve',
          audio: {loadOriginalBytes: async () => bytes},
        },
      },
      controller.signal,
      () => {},
    );

    await waitFor(() => fake !== undefined);
    fake!.emit({type: 'loaded'});
    controller.abort();

    await expect(runPromise).rejects.toMatchObject({name: 'AbortError'});
    expect(fake!.terminated).toBe(true);
    expect(mockAlignVocals).not.toHaveBeenCalled();
  });

  it('propagates a real alignment error (not AbortError)', async () => {
    const bytes = new Uint8Array([30, 31, 32, 33]);
    const fingerprint = await computeStemFingerprint(
      bytes,
      ROFORMER_SEPARATOR_ID,
    );
    await storeStemOpus(fingerprint, 'vocals', new Uint8Array([1, 2, 3]));
    mockResample.mockResolvedValue(new Float32Array([0.1]));
    mockAlignVocals.mockRejectedValue(new Error('alignment failed'));

    const controller = new AbortController();
    await expect(
      addLyricsTask.run(
        {
          lyrics: 'la la',
          vocals: {
            kind: 'resolve',
            audio: {loadOriginalBytes: async () => bytes},
          },
        },
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow('alignment failed');
  });
});

describe('generateTempoMapTask', () => {
  beforeEach(() => {
    mockDecode.mockReset();
  });

  it('planSteps marks the separation steps cached when a drum stem already exists', async () => {
    const bytes = new Uint8Array([41, 42, 43, 44]);
    const fingerprint = await computeStemFingerprint(
      bytes,
      ROFORMER_SEPARATOR_ID,
    );
    await storeStem(fingerprint, 'drums', {
      left: new Float32Array([0.1, 0.2]),
      right: new Float32Array([0.3, 0.4]),
    });

    const steps = await makeGenerateTempoMapTask().planSteps({
      audio: {loadOriginalBytes: async () => bytes},
    });
    expect(steps.find(s => s.key === 'separate')?.cached).toBe(true);
    expect(steps.find(s => s.key === 'download-separation-model')?.cached).toBe(
      true,
    );
    expect(steps.find(s => s.key === 'beats-fullmix')?.cached).toBe(false);
  });

  it('planSteps marks the separation steps uncached on a miss', async () => {
    const steps = await makeGenerateTempoMapTask().planSteps({
      audio: {loadOriginalBytes: async () => new Uint8Array([45, 46, 47, 48])},
    });
    expect(steps.find(s => s.key === 'separate')?.cached).toBe(false);
    expect(steps.find(s => s.key === 'download-separation-model')?.cached).toBe(
      false,
    );
  });

  it('analyzes the caller-supplied decoded mix rather than the fingerprint file', async () => {
    // A chart package is several stem files; its first file is what the
    // stem-cache fingerprint is taken from, but beat tracking has to see the
    // whole song, so a host that has stems supplies the mixdown itself.
    const bytes = new Uint8Array([61, 62, 63, 64]);
    const mixed = {
      length: 3,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.5, 0.5, 0.5]),
    } as unknown as AudioBuffer;
    mockDecode.mockResolvedValue(fakeAudioBuffer());

    let fake: FakeWorker | undefined;
    const task = makeGenerateTempoMapTask({
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      transcriber: {
        transcribe: async () => ({events: [], modelOutput: null}),
      } as unknown as DrumTranscriber,
    });
    const runPromise = task.run(
      {
        audio: {
          loadOriginalBytes: async () => bytes,
          loadDecodedMix: async () => mixed,
        },
      },
      new AbortController().signal,
      () => {},
    );

    await waitFor(() => (fake?.posted.length ?? 0) > 0);
    expect(mockDecode).not.toHaveBeenCalled();
    expect(Array.from(fake!.posted[0].left as Float32Array)).toEqual([
      0.5, 0.5, 0.5,
    ]);

    fake!.emit({
      type: 'result',
      result: {
        synctrack: {origin_ms: 0, tempos: [], timeSignatures: []},
        sections: null,
        drumOnsetOffsetMs: null,
        fullMixBeatCount: 0,
        drumStemBeatCount: 0,
        meterStats: null,
        drumStemStereo: {
          left: new Float32Array(4096),
          right: new Float32Array(4096),
        },
      },
    });
    await runPromise;
  });

  it('hands the pipeline worker the fingerprint and no stem, even on a cache hit', async () => {
    // The worker is the one authority on the drum-stem cache: it loads the
    // cached stem in the thread that consumes it. A cached stem must
    // therefore never be read on the main thread and transferred in.
    const bytes = new Uint8Array([51, 52, 53, 54]);
    const fingerprint = await computeStemFingerprint(
      bytes,
      ROFORMER_SEPARATOR_ID,
    );
    await storeStem(fingerprint, 'drums', {
      left: new Float32Array([0.1, 0.2]),
      right: new Float32Array([0.3, 0.4]),
    });
    mockDecode.mockResolvedValue(fakeAudioBuffer());

    let fake: FakeWorker | undefined;
    const task = makeGenerateTempoMapTask({
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      // The run anchors the grid on transcribed drum hits (the same
      // finalization /drum-transcription performs), so it always transcribes
      // the stem the pipeline hands back.
      transcriber: {
        transcribe: async () => ({events: [], modelOutput: null}),
      } as unknown as DrumTranscriber,
    });
    const runPromise = task.run(
      {audio: {loadOriginalBytes: async () => bytes}},
      new AbortController().signal,
      () => {},
    );

    await waitFor(() => (fake?.posted.length ?? 0) > 0);
    expect(fake!.posted[0].type).toBe('run');
    expect(fake!.posted[0].fingerprint).toBe(fingerprint);
    expect(fake!.posted[0].drumStemStereo).toBeNull();

    fake!.emit({
      type: 'result',
      result: {
        synctrack: {origin_ms: 0, tempos: [], timeSignatures: []},
        sections: null,
        drumOnsetOffsetMs: null,
        fullMixBeatCount: 0,
        drumStemBeatCount: 0,
        meterStats: null,
        drumStemStereo: {
          left: new Float32Array(4096),
          right: new Float32Array(4096),
        },
      },
    });

    const result = await runPromise;
    expect(result.synctrack.tempos).toEqual([]);
  });

  it('finalizes the worker grid through KS-warp/REACH before returning it', async () => {
    // The shipping /tempo path: TempoClient -> generateTempoMapTask.run ->
    // runTempoTrack -> finalizeSynctrack. tempo-track-equivalence.test.ts
    // pins that finalizeSynctrack agrees with chart-builder's call site, but
    // only this asserts that /tempo's own task actually runs it — without it,
    // dropping the warp from tempo-track.ts would ship a raw grid silently.
    const fixture = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          '../../tempo-map/__tests__/fixtures/ks-warp-reach/reach-01.json',
        ),
        'utf8',
      ),
    ) as {
      incumbent_grid: Synctrack;
      ks_onsets_ms: number[];
      all_onsets_ms: number[];
    };
    const ksSet = new Set(fixture.ks_onsets_ms);
    const events = [
      ...fixture.ks_onsets_ms.map(ms => ({
        timeSeconds: ms / 1000,
        drumClass: 'BD' as const,
        midiPitch: 36,
        confidence: 1,
      })),
      ...fixture.all_onsets_ms
        .filter(ms => !ksSet.has(ms))
        .map(ms => ({
          timeSeconds: ms / 1000,
          drumClass: 'HH' as const,
          midiPitch: 42,
          confidence: 1,
        })),
    ];
    const expected = finalizeSynctrack(fixture.incumbent_grid, events);
    // Guards against a vacuous assertion: this fixture's warp really does
    // move the grid, so returning the raw one would fail below.
    expect(expected).not.toEqual(fixture.incumbent_grid);

    mockDecode.mockResolvedValue(fakeAudioBuffer());
    let fake: FakeWorker | undefined;
    const task = makeGenerateTempoMapTask({
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      transcriber: {
        transcribe: async () => ({events, durationSeconds: 300}),
      } as unknown as DrumTranscriber,
    });
    const runPromise = task.run(
      {audio: {loadOriginalBytes: async () => new Uint8Array([71, 72])}},
      new AbortController().signal,
      () => {},
    );

    await waitFor(() => (fake?.posted.length ?? 0) > 0);
    fake!.emit({
      type: 'result',
      result: {
        synctrack: fixture.incumbent_grid,
        sections: null,
        drumOnsetOffsetMs: null,
        fullMixBeatCount: 0,
        drumStemBeatCount: 0,
        meterStats: null,
        drumStemStereo: {
          left: new Float32Array(4096),
          right: new Float32Array(4096),
        },
      },
    });

    const result = await runPromise;
    expect(result.synctrack).toEqual(expected);
  });
});
