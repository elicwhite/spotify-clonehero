/**
 * @jest-environment jsdom
 */
/**
 * app/tempo/TempoClient.tsx tests (plan 0074 Phase 6, Task 6b).
 *
 * `/tempo`'s pick -> processing -> results flow, rewired onto the shared
 * assist engine (`generate-tempo-map`). The processing phase renders the
 * ENGINE's own step list, driven by a `FakeWorker` scripted through
 * `makeGenerateTempoMapTask`'s `createWorker` seam — no page-local step
 * bookkeeping remains. Heavy chart-editor children (highway, piano roll,
 * transport, AudioManager) are stubbed at the same boundary
 * `DifficultyGenerationFlow.test.tsx` uses; real audio decode is mocked out
 * (`decode-audio.ts`, `merge-audio.ts`) since jsdom has no Web Audio decode.
 */

import '@testing-library/jest-dom';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';

import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';

// jest.mock's first argument is resolved directly (not alias-rewritten), so
// mocks below use relative paths to the same files the `@/...` imports
// elsewhere resolve to — same convention as lib/assist/__tests__/tasks.test.ts.
jest.mock('../../../lib/audio-pipeline/decode-audio', () => ({
  decodeAndResampleTo44k: jest.fn(),
  decodeNativeRate: jest.fn(),
}));
jest.mock('../../../lib/tempo-map/merge-audio', () => ({
  mergeAudioFiles: jest.fn(),
}));
// Resampling the separated stem to the CRNN's rate pulls a wasm resampler
// over the network; the rate conversion is not what this page's flow is
// about.
jest.mock('../../../lib/drum-transcription/pipeline/crnn-audio-prep', () => ({
  planarStereoToCrnnInput: jest.fn(async () => new Float32Array(8)),
}));
jest.mock('../../../components/chart-editor/HighwayEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="highway-editor-stub" />,
}));
jest.mock(
  '../../../components/chart-editor/piano-roll/PianoRollTimeline',
  () => ({
    __esModule: true,
    default: () => <div data-testid="piano-roll-stub" />,
  }),
);
jest.mock('../../../components/chart-editor/TransportControls', () => ({
  __esModule: true,
  default: () => <div data-testid="transport-controls-stub" />,
}));
jest.mock('../../../lib/preview/clickTrack', () => ({
  CLICK_TRACK_NAME: 'click',
  generateBeatClickTrackWav: jest.fn(async () => new Uint8Array([0])),
}));

const audioManagers: {
  trackNames: string[];
  setChartDelay: jest.Mock;
  setVolume: jest.Mock;
  getVolume: jest.Mock;
  destroy: jest.Mock;
}[] = [];
jest.mock('../../../lib/preview/audioManager', () => ({
  AudioManager: jest.fn().mockImplementation(function (
    this: any,
    audioFiles: {fileName: string}[],
  ) {
    this.ready = Promise.resolve();
    this.trackNames = audioFiles.map(f => f.fileName);
    this.setChartDelay = jest.fn();
    this.setVolume = jest.fn();
    this.getVolume = jest.fn(() => 1);
    this.destroy = jest.fn();
    this.isPlaying = false;
    this.chartTime = 0;
    this.duration = 5;
    this.pause = jest.fn(async () => {});
    this.resume = jest.fn(async () => {});
    this.seekToChartTime = jest.fn(async () => {});
    audioManagers.push(this);
  }),
}));

import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {mergeAudioFiles} from '@/lib/tempo-map/merge-audio';
import {makeGenerateTempoMapTask} from '@/lib/assist/tasks/generate-tempo-map';
import type {
  PipelineWorkerMessage,
  PipelineRunRequest,
} from '@/lib/tempo-map/types';
import type {DrumTranscriber} from '@/lib/drum-transcription/ml/transcriber';
import TempoClient from '../TempoClient';

const mockDecode = decodeAndResampleTo44k as jest.Mock;
const mockMerge = mergeAudioFiles as jest.Mock;

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver =
  FakeResizeObserver;

(globalThis.navigator as any).gpu = {
  requestAdapter: async () => ({}),
};

// jsdom has neither `Blob.prototype.arrayBuffer` (the file-picker branch
// calls `input.file.arrayBuffer()`) nor `crypto.subtle` (the stem cache's
// fingerprint hash) — polyfill both with real implementations rather than
// mocking the code under test.
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
if (!globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: require('crypto').webcrypto.subtle,
    configurable: true,
  });
}
// jsdom's window doesn't expose the (de)compression streams stem-cache.ts
// gzips cached stems through — Node itself has them (`node:stream/web`).
if (typeof (globalThis as any).CompressionStream === 'undefined') {
  const streamWeb = require('node:stream/web');
  (globalThis as any).CompressionStream = streamWeb.CompressionStream;
  (globalThis as any).DecompressionStream = streamWeb.DecompressionStream;
}

installFakeOPFS();

function fakeAudioBuffer({
  duration = 5,
  sampleRate = 44100,
  numberOfChannels = 2,
}: {
  duration?: number;
  sampleRate?: number;
  numberOfChannels?: number;
} = {}): AudioBuffer {
  const length = Math.round(duration * sampleRate);
  return {
    duration,
    sampleRate,
    numberOfChannels,
    length,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

class FakeWorker {
  onmessage: ((e: {data: PipelineWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: PipelineRunRequest[] = [];
  terminated = false;
  postMessage(msg: PipelineRunRequest) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: PipelineWorkerMessage) {
    this.onmessage?.({data: msg});
  }
}

let fakeWorker: FakeWorker | null = null;
function scriptedTask() {
  return makeGenerateTempoMapTask({
    createWorker: () => {
      fakeWorker = new FakeWorker();
      return fakeWorker as unknown as Worker;
    },
    // The run transcribes the separated stem to anchor the grid; the model
    // itself needs a GPU, so stand in for it.
    transcriber: {
      transcribe: async () => ({events: [], modelOutput: null}),
    } as unknown as DrumTranscriber,
  });
}

function fakePipelineResult(
  drumStemStereo: {left: Float32Array; right: Float32Array} | null = null,
) {
  return {
    synctrack: {
      origin_ms: 0,
      tempos: [{ms: 0, bpm: 120}],
      timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
    },
    sections: null,
    drumOnsetOffsetMs: null,
    fullMixBeatCount: 0,
    drumStemBeatCount: 0,
    meterStats: null,
    drumStemStereo,
  };
}

async function pickAudioFile(name = 'song.mp3') {
  const file = new File([new Uint8Array([1, 2, 3, 4])], name, {
    type: 'audio/mpeg',
  });
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, {target: {files: [file]}});
  });
}

beforeEach(() => {
  fakeWorker = null;
  audioManagers.length = 0;
  mockDecode.mockReset().mockResolvedValue(fakeAudioBuffer());
  mockMerge.mockReset().mockResolvedValue(fakeAudioBuffer());
});

describe('TempoClient', () => {
  it('shows the engine-driven step list while a run is in flight', async () => {
    render(<TempoClient task={scriptedTask()} />);

    await waitFor(() =>
      expect(screen.getByText('Pick a song file')).toBeInTheDocument(),
    );
    await pickAudioFile();

    // The engine's own planned steps for generate-tempo-map, not any
    // page-local step table.
    expect(await screen.findByText('Isolating the drums')).toBeInTheDocument();
    expect(screen.getByText('Building the tempo map')).toBeInTheDocument();

    await waitFor(() => expect(fakeWorker).not.toBeNull());
    act(() => {
      fakeWorker!.emit({
        type: 'progress',
        stage: 'beats-fullmix',
        percent: 0.5,
      });
    });

    await waitFor(() =>
      expect(
        screen.getByText('Finding the beat of the whole song'),
      ).toBeInTheDocument(),
    );
  });

  it('cancel mid-run terminates the worker and returns to the picker', async () => {
    render(<TempoClient task={scriptedTask()} />);

    await waitFor(() =>
      expect(screen.getByText('Pick a song file')).toBeInTheDocument(),
    );
    await pickAudioFile();
    await waitFor(() => expect(fakeWorker).not.toBeNull());

    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    await waitFor(() =>
      expect(screen.getByText('Pick a song file')).toBeInTheDocument(),
    );
    expect(fakeWorker!.terminated).toBe(true);
    expect(audioManagers).toHaveLength(0);
  });

  it('lands in the results editor on success, with the drum stem picked up as a stem', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    // Nothing is seeded into the stem cache: the drum stem the results view
    // plays is the one the run itself returned, not a main-thread re-read.
    const drums = {
      left: new Float32Array([0.1, 0.2]),
      right: new Float32Array([0.3, 0.4]),
    };

    render(<TempoClient task={scriptedTask()} />);
    await waitFor(() =>
      expect(screen.getByText('Pick a song file')).toBeInTheDocument(),
    );

    const file = new File([bytes], 'song.mp3', {type: 'audio/mpeg'});
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {target: {files: [file]}});
    });

    await waitFor(() => expect(fakeWorker).not.toBeNull());
    fakeWorker!.emit({type: 'result', result: fakePipelineResult(drums)});

    expect(
      await screen.findByRole('button', {name: 'Start over'}),
    ).toBeInTheDocument();
    // The AudioManager builds once with just the full mix, then rebuilds
    // once the drum stem is decoded and picked up as a named stem — assert
    // on whichever build (there may be more than one) ends up carrying it.
    await waitFor(() =>
      expect(audioManagers.some(m => m.trackNames.includes('drums.wav'))).toBe(
        true,
      ),
    );
    const latest = audioManagers[audioManagers.length - 1];
    expect(latest.trackNames).toEqual(
      expect.arrayContaining(['song.wav', 'drums.wav', 'click.wav']),
    );
  });

  it('reports a failed run in place, with a way back to the picker', async () => {
    render(<TempoClient task={scriptedTask()} />);
    await waitFor(() =>
      expect(screen.getByText('Pick a song file')).toBeInTheDocument(),
    );
    await pickAudioFile();
    await waitFor(() => expect(fakeWorker).not.toBeNull());

    fakeWorker!.emit({type: 'error', message: 'Pipeline exploded'});

    expect(await screen.findByText('Pipeline exploded')).toBeInTheDocument();
    expect(screen.queryByText('Pick a song file')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /^back$/i}));
    await waitFor(() =>
      expect(screen.getByText('Pick a song file')).toBeInTheDocument(),
    );
  });
});
