/**
 * The `transcribe-drums` task's audio-backed composition: an editor host with
 * no OPFS drum-transcription project.
 *
 * The load-bearing claims are that the run re-separates the mix the host
 * hands over (never a stem the user supplied), that it shares the
 * fingerprint-keyed stem cache with the tempo map, and that the notes come
 * back snapped to the chart's OWN SyncTrack. Only the GPU boundary
 * (separation) and the resampler are mocked; chart building is real, so the
 * ticks asserted below are the ones the snap stage produced.
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import type {DrumTranscriber} from '@/lib/drum-transcription/ml/transcriber';
import type {RawDrumEvent} from '@/lib/drum-transcription/ml/types';

// jest.mock's first argument is a bare string Jest resolves directly (SWC
// only rewrites the `@/...` alias inside real `import` specifiers), so the
// mock registrations below use relative paths to the same files the `@/...`
// imports resolve to.
jest.mock('../../audio-pipeline/separate-stems', () => ({
  DRUMS_STEM: 'drums',
  VOCALS_STEM: 'vocals',
  separateStems: jest.fn(),
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

import {separateStems} from '@/lib/audio-pipeline/separate-stems';
import {
  computeStemFingerprint,
  hasStem,
  ROFORMER_SEPARATOR_ID,
  storeStem,
} from '@/lib/audio-pipeline/stem-cache';
import {makeTranscribeDrumsFromAudioTask} from '../tasks/transcribe-drums-from-audio';
import type {AssistAudio} from '../tasks/types';
import type {StepProgressEvent} from '../run-to-steps';

const mockSeparate = separateStems as jest.Mock;

// The stem cache is used for real (the cached-step prediction is exactly
// what's under test), so it needs OPFS.
installFakeOPFS();

// The task waits for the page's ONNX Runtime <Script> before starting a run.
// The runtime itself is never used here (every model call is mocked).
(globalThis as {ort?: unknown}).ort = {};

/** Kick on beat 1, snare on beat 2, at the chart's 120 BPM (0.5 s/beat). */
const EVENTS: RawDrumEvent[] = [
  {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
  {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.8},
];

const transcriber: DrumTranscriber = {
  transcribe: async () => ({
    events: EVENTS,
    modelOutput: {predictions: new Float32Array(0), nFrames: 0, nClasses: 9},
    durationSeconds: 4,
  }),
};

const task = makeTranscribeDrumsFromAudioTask({transcriber});

/** A hand-written 120 BPM chart with an (empty) Expert Drums track. */
function chartAt120(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 192});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  return {parsedChart: parsed, assets: []};
}

/** The song as the host mixes it down: one buffer of bytes, whatever the
 *  package's stems were. */
const MIX_BYTES = new Uint8Array([9, 8, 7, 6]);

function audio(): AssistAudio {
  return {loadOriginalBytes: async () => MIX_BYTES};
}

function stem(): {left: Float32Array; right: Float32Array} {
  return {left: new Float32Array(1024), right: new Float32Array(1024)};
}

describe('transcribeDrumsFromAudioTask', () => {
  beforeEach(() => {
    mockSeparate.mockReset();
    mockSeparate.mockResolvedValue({drums: stem()});
  });

  it('separates the mix the host supplies rather than transcribing a supplied stem', async () => {
    const controller = new AbortController();
    await task.run(
      {audio: audio(), chartDoc: chartAt120()},
      controller.signal,
      () => {},
    );

    expect(mockSeparate).toHaveBeenCalledTimes(1);
    const [bytes, opts] = mockSeparate.mock.calls[0];
    expect(bytes).toBe(MIX_BYTES);
    expect(opts).toMatchObject({drums: true});
  });

  it('snaps the transcribed hits onto the chart’s own grid and leaves the SyncTrack alone', async () => {
    const doc = chartAt120();
    const controller = new AbortController();
    const result = await task.run(
      {audio: audio(), chartDoc: doc},
      controller.signal,
      () => {},
    );

    // 120 BPM at 192 ticks/beat: beat 1 is tick 0, beat 2 is tick 192.
    expect(result.notes.map(n => n.tick)).toEqual([0, 192]);
    expect(result.sync.resolution).toBe(doc.parsedChart.resolution);
    expect(result.sync.tempos).toEqual(doc.parsedChart.tempos);
    expect(result.sync.timeSignatures).toEqual(doc.parsedChart.timeSignatures);
  });

  it('reports separating then transcribing, ending on done', async () => {
    const events: StepProgressEvent[] = [];
    const controller = new AbortController();
    await task.run(
      {audio: audio(), chartDoc: chartAt120()},
      controller.signal,
      e => events.push(e),
    );

    const order = ['separating', 'transcribing'];
    const seen = events
      .filter(e => e.activeKey !== null)
      .map(e => order.indexOf(e.activeKey as string));
    expect(seen.every(i => i >= 0)).toBe(true);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(events.at(-1)).toEqual({activeKey: null, terminal: 'done'});
  });

  it('plans "separating" as cached when this mix is already in the shared stem cache', async () => {
    const fingerprint = await computeStemFingerprint(
      MIX_BYTES,
      ROFORMER_SEPARATOR_ID,
    );
    expect(await hasStem(fingerprint, 'drums')).toBe(false);
    const uncached = await task.planSteps({
      audio: audio(),
      chartDoc: chartAt120(),
    });
    expect(uncached.find(s => s.key === 'separating')?.cached).toBe(false);

    // The same entry the tempo map's separation would have written.
    await storeStem(fingerprint, 'drums', stem());

    const cached = await task.planSteps({
      audio: audio(),
      chartDoc: chartAt120(),
    });
    expect(cached.find(s => s.key === 'separating')?.cached).toBe(true);
    // Nothing predicts a tempo-mapping step: the chart's grid is the grid.
    expect(cached.map(s => s.key)).toEqual([
      'loading-runtime',
      'separating',
      'transcribing',
    ]);
  });

  it('rejects with AbortError when cancelled before separation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      task.run(
        {audio: audio(), chartDoc: chartAt120()},
        controller.signal,
        () => {},
      ),
    ).rejects.toMatchObject({name: 'AbortError'});
    expect(mockSeparate).not.toHaveBeenCalled();
  });

  it('fails loudly when separation yields no drum stem', async () => {
    mockSeparate.mockResolvedValue({});
    const controller = new AbortController();
    await expect(
      task.run(
        {audio: audio(), chartDoc: chartAt120()},
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow('no drum stem');
  });
});
