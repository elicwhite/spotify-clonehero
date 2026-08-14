/**
 * @jest-environment jsdom
 */
/**
 * `/add-lyrics` home screen on the assist engine (plan 0074 Phase 6, Task 6a,
 * Suite 7).
 *
 * `AddLyricsClient` runs the shared `add-lyrics` task
 * (`lib/assist/tasks/add-lyrics.ts`) through its own
 * `useAssistRunnerControls()`, so the step list it renders is the engine's
 * own. The vocals-resolution rule (roformer-cache-else-Demucs) and the stem cache
 * (`lib/audio-pipeline/stem-cache.ts`, backed by `fake-opfs.ts`) run for
 * real, so "warm cache"/"cold cache" prove the routing genuinely happens
 * rather than asserting a mock's own bookkeeping (same approach as
 * `lib/assist/__tests__/tasks.test.ts`). `alignVocals`,
 * `decodeAndResampleTo44k`, and `resampleTo16kMono`/`mixStemsToAudioBuffer`
 * are mocked module boundaries (no real ONNX/AudioContext decode in jsdom).
 * `ChartEditor` is stubbed, matching `drum-transcription-visibility-
 * seeding.test.tsx` — this suite is about the alignment pipeline, not the
 * editor it hands off to.
 */

import '@testing-library/jest-dom';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import {zipSync} from 'fflate';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {writeChartFolder, type ChartDocument} from '@/lib/chart-edit';
import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {
  computeStemFingerprint,
  ROFORMER_SEPARATOR_ID,
  storeStemOpus,
} from '@/lib/audio-pipeline/stem-cache';
import {VOCALS_STEM} from '@/lib/audio-pipeline/separate-stems';

// jsdom has neither `Blob.prototype.arrayBuffer` (the zip reader calls
// `file.arrayBuffer()`), `crypto.subtle` (the stem cache's fingerprint
// hash), nor the (de)compression streams stem-cache.ts gzips cached stems
// through — polyfill all three with real Node implementations rather than
// mocking the code under test (same convention as
// app/tempo/__tests__/TempoClient.test.tsx).
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
if (typeof (globalThis as any).CompressionStream === 'undefined') {
  const streamWeb = require('node:stream/web');
  (globalThis as any).CompressionStream = streamWeb.CompressionStream;
  (globalThis as any).DecompressionStream = streamWeb.DecompressionStream;
}

installFakeOPFS();

// `ChartEditor` — the results screen it renders is a different suite's
// concern; a stub proves the page reached "done" without dragging in the
// highway/piano-roll/WebGL stack.
const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({push: mockRouterPush}),
}));

const createdProjects: {origin: string}[] = [];
jest.mock('../../../lib/project-storage/createProjectFromDoc', () => ({
  createProjectFromDoc: jest.fn(async (opts: never) => {
    createdProjects.push(opts);
    return `project-${createdProjects.length}`;
  }),
}));


// Audio boundary — no real Web Audio in jsdom.
jest.mock('../../../lib/preview/audioManager', () => ({
  AudioManager: jest.fn().mockImplementation(function (this: any) {
    this.ready = Promise.resolve();
    this.duration = 10;
    this.setChartDelay = jest.fn();
    this.destroy = jest.fn();
  }),
}));

jest.mock('../../../lib/lyrics-align/aligner', () => ({
  init: jest.fn(async () => {}),
  alignVocals: jest.fn(),
}));

jest.mock('../../../lib/audio-pipeline/decode-audio', () => ({
  decodeAndResampleTo44k: jest.fn(async () => fakeAudioBuffer()),
}));

// Walking this flow fires analytics, and with no GA script loaded
// @next/third-parties warns on every event. lib/analytics/track.ts already
// swallows analytics failures, but a warning is not throwable, so the only
// way to keep it out of the run is to not reach the real sendGAEvent.
jest.mock('@next/third-parties/google', () => ({
  sendGAEvent: jest.fn(),
}));

jest.mock('../../../lib/audio-pipeline/lyrics-audio', () => ({
  resampleTo16kMono: jest.fn(),
  mixStemsToAudioBuffer: jest.fn(async () => fakeAudioBuffer()),
}));

/** A controllable fake worker matching demucs-worker.ts's message protocol
 *  (same shape as lib/assist/__tests__/tasks.test.ts's FakeWorker). */
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

const spawnedWorkers: FakeWorker[] = [];
jest.mock('../../../lib/lyrics-align/demucs-client', () => {
  const actual = jest.requireActual('../../../lib/lyrics-align/demucs-client');
  return {
    ...actual,
    defaultCreateDemucsWorker: () => {
      const w = new FakeWorker();
      spawnedWorkers.push(w);
      return w as unknown as Worker;
    },
  };
});

import AddLyricsClient from '../AddLyricsClient';
import {alignVocals} from '@/lib/lyrics-align/aligner';
import {resampleTo16kMono} from '@/lib/audio-pipeline/lyrics-audio';

const mockAlignVocals = alignVocals as jest.Mock;
const mockResample = resampleTo16kMono as jest.Mock;

function fakeAudioBuffer(): AudioBuffer {
  return {
    length: 2,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([0, 0]),
  } as unknown as AudioBuffer;
}

function notesChartBytes(): Uint8Array {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.format = 'chart';
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  const files = writeChartFolder(doc);
  const notesFile = files.find(f => f.fileName === 'notes.chart');
  if (!notesFile) throw new Error('fixture: no notes.chart produced');
  // `zipSync` misidentifies whatever exotic Uint8Array subclass
  // `writeChartFolder` returns as a nested `Zippable` folder rather than a
  // file's bytes; a plain copy is a real `Uint8Array` it handles correctly.
  return new Uint8Array(notesFile.data);
}

/** Builds a `.zip` `File` — the same package shape `ChartDropZone`'s hidden
 *  file input hands `readZipFile`. `audioFiles` maps a stem file name to its
 *  bytes, so a test can control exactly what the roformer-cache fingerprint
 *  and Demucs fallback see. */
function buildChartZip(audioFiles: Record<string, Uint8Array>): File {
  const zipped = zipSync({
    'notes.chart': notesChartBytes(),
    ...audioFiles,
  });
  return new File([zipped as unknown as BlobPart], 'chart.zip', {
    type: 'application/zip',
  });
}

/** Drops a chart zip through `ChartDropZone`'s hidden file input, pastes
 *  lyrics, and clicks Align. The click runs inside `act` so the progress
 *  ticks the run emits before it first suspends land in a React batch. */
async function loadChartAndAlign(audioFiles: Record<string, Uint8Array>) {
  render(<AddLyricsClient />);

  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, {target: {files: [buildChartZip(audioFiles)]}});

  await screen.findByText(/paste lyrics/i);
  fireEvent.change(screen.getByPlaceholderText(/paste the song lyrics/i), {
    target: {value: 'la la la'},
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', {name: /align lyrics/i}));
  });
}

function alignResult(overrides: Record<string, unknown> = {}) {
  return {
    lines: [],
    words: [],
    syllables: [
      {text: 'la', startMs: 0, endMs: 100, joinNext: false, newLine: true},
    ],
    durationMs: 100,
    lowConfidenceFrac: 0,
    lowConfidence: false,
    ...overrides,
  };
}

beforeEach(() => {
    createdProjects.length = 0;
    mockRouterPush.mockClear();
  spawnedWorkers.length = 0;
  mockAlignVocals.mockReset();
  mockResample.mockReset();
});

describe('/add-lyrics home screen on the assist engine', () => {
  it('reuses a warm roformer cache and never spawns Demucs', async () => {
    const songBytes = new Uint8Array([1, 2, 3, 4]);
    const fingerprint = await computeStemFingerprint(
      songBytes,
      ROFORMER_SEPARATOR_ID,
    );
    const opusBytes = new Uint8Array([9, 9, 9]);
    await storeStemOpus(fingerprint, VOCALS_STEM, opusBytes);

    mockResample.mockResolvedValue(new Float32Array([0.1, 0.2]));
    mockAlignVocals.mockResolvedValue(alignResult());

    await loadChartAndAlign({'song.ogg': songBytes});

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());

    expect(spawnedWorkers).toHaveLength(0);
    expect(mockResample).toHaveBeenCalledWith(opusBytes, 'audio/opus');
  });

  it('saves the aligned chart as a project and opens it in /chart-editor', async () => {
    // Warm cache, so the run resolves without a Demucs worker to drive.
    const songBytes = new Uint8Array([1, 2, 3, 4]);
    const fingerprint = await computeStemFingerprint(
      songBytes,
      ROFORMER_SEPARATOR_ID,
    );
    await storeStemOpus(fingerprint, VOCALS_STEM, new Uint8Array([9, 9, 9]));
    mockResample.mockResolvedValue(new Float32Array([0.1, 0.2]));
    mockAlignVocals.mockResolvedValue(alignResult());

    await loadChartAndAlign({'song.ogg': songBytes});

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    expect(mockRouterPush).toHaveBeenCalledWith(
      '/chart-editor?project=project-1',
    );
    expect(createdProjects).toHaveLength(1);
    expect(createdProjects[0]).toMatchObject({origin: 'add-lyrics'});
  });

  it('separates with Demucs on a cold cache', async () => {
    mockAlignVocals.mockResolvedValue(alignResult());

    await loadChartAndAlign({'song.ogg': new Uint8Array([5, 6, 7, 8])});

    await waitFor(() => expect(spawnedWorkers).toHaveLength(1));
    act(() => spawnedWorkers[0].emit({type: 'loaded'}));
    expect(spawnedWorkers[0].posted[1]?.type).toBe('separate');
    act(() =>
      spawnedWorkers[0].emit({
        type: 'result',
        vocals16k: new Float32Array([0.3, 0.4]),
      }),
    );

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());

    expect(spawnedWorkers[0].terminated).toBe(true);
    // The cache-resample path never runs on a Demucs separation.
    expect(mockResample).not.toHaveBeenCalled();
  });

  it('cancel mid-align terminates the worker and returns to the paste form', async () => {
    await loadChartAndAlign({'song.ogg': new Uint8Array([11, 12, 13, 14])});

    await waitFor(() => expect(spawnedWorkers).toHaveLength(1));
    act(() => spawnedWorkers[0].emit({type: 'loaded'}));

    const cancelButton = await screen.findByRole('button', {
      name: /^cancel$/i,
    });
    fireEvent.click(cancelButton);

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/paste the song lyrics/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText(/paste the song lyrics/i)).toHaveValue(
      'la la la',
    );
    expect(spawnedWorkers[0].terminated).toBe(true);
    expect(mockAlignVocals).not.toHaveBeenCalled();
  });

  it('escalates to tier 2 when the low-confidence pass came from the stem cache', async () => {
    // Pass 1 resolving vocals out of the roformer cache is just as
    // escalatable as a bundled stem: neither separated this mix, so a fresh
    // Demucs run is still something new to try.
    const songBytes = new Uint8Array([41, 42, 43, 44]);
    const fingerprint = await computeStemFingerprint(
      songBytes,
      ROFORMER_SEPARATOR_ID,
    );
    await storeStemOpus(fingerprint, VOCALS_STEM, new Uint8Array([7, 7, 7]));

    mockResample.mockResolvedValue(new Float32Array([0.1]));
    mockAlignVocals
      .mockResolvedValueOnce(
        alignResult({lowConfidence: true, lowConfidenceFrac: 0.9}),
      )
      .mockResolvedValueOnce(alignResult());

    await loadChartAndAlign({
      'song.ogg': songBytes,
      'guitar.ogg': new Uint8Array([51, 52, 53, 54]),
    });

    await screen.findByText(/trying again with a fresh separation/i);
    await waitFor(() => expect(spawnedWorkers).toHaveLength(1));
    act(() => spawnedWorkers[0].emit({type: 'loaded'}));
    act(() =>
      spawnedWorkers[0].emit({
        type: 'result',
        vocals16k: new Float32Array([0.5, 0.6]),
      }),
    );

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    expect(mockAlignVocals).toHaveBeenCalledTimes(2);
  });

  it('escalates to a tier-2 Demucs re-separation on a low-confidence bundled-stem alignment', async () => {
    mockResample.mockResolvedValue(new Float32Array([0.1]));
    // How many Demucs workers existed at each alignment call, recorded from
    // inside the call: which pass separated is then a property of the run
    // rather than of when the assertions happen to look.
    const workersAtAlign: number[] = [];
    mockAlignVocals
      .mockImplementationOnce(async () => {
        workersAtAlign.push(spawnedWorkers.length);
        return alignResult({lowConfidence: true, lowConfidenceFrac: 0.9});
      })
      .mockImplementationOnce(async () => {
        workersAtAlign.push(spawnedWorkers.length);
        return alignResult({
          lowConfidence: false,
          lowConfidenceFrac: 0.1,
          syllables: [
            {
              text: 'la',
              startMs: 0,
              endMs: 100,
              joinNext: false,
              newLine: true,
            },
            {
              text: 'da',
              startMs: 100,
              endMs: 200,
              joinNext: false,
              newLine: false,
            },
          ],
        });
      });

    // A bundled vocals stem plus at least one other audio file — the two
    // preconditions `canEscalate` requires alongside a low-confidence pass.
    await loadChartAndAlign({
      'song.ogg': new Uint8Array([21, 22, 23, 24]),
      'vocals.ogg': new Uint8Array([31, 32, 33, 34]),
    });

    // Tier 2's variant step list: the same task, a distinguishing caption.
    await screen.findByText(/trying again with a fresh separation/i);

    await waitFor(() => expect(spawnedWorkers).toHaveLength(1));
    act(() => spawnedWorkers[0].emit({type: 'loaded'}));
    act(() =>
      spawnedWorkers[0].emit({
        type: 'result',
        vocals16k: new Float32Array([0.5, 0.6]),
      }),
    );

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());

    expect(mockAlignVocals).toHaveBeenCalledTimes(2);
    expect(spawnedWorkers[0].terminated).toBe(true);
    // Pass 1 aligned the bundled vocals with no Demucs worker in existence;
    // only tier 2 separated.
    expect(workersAtAlign).toEqual([0, 1]);
  });
});
