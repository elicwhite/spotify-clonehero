/**
 * @jest-environment jsdom
 */
/**
 * `usePaddedAudio` stem-list generalization (plan 0074 Phase 5 Task 5a).
 *
 * `AudioManager` is stubbed at the boundary (`@/lib/preview/audioManager`) —
 * these tests never touch real Web Audio — capturing the audio-file names
 * its fake constructor receives so we can assert one WAV per stem, plus
 * `song.wav` and `click.wav`, is produced for an arbitrary stem list.
 */

import '@testing-library/jest-dom';

// jsdom's Blob has no `arrayBuffer()`; `encodeWavBlob` (used inside
// `buildPaddedAudioManager`) relies on it. Node's Blob implementation
// supports it and is otherwise spec-compatible, so swap it in for tests.
(globalThis as unknown as {Blob: unknown}).Blob = require('buffer').Blob;

import {act} from 'react';
import {renderHook, waitFor} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {setAudioAnchor} from '@/lib/chart-edit';
import type {AudioStemInput} from '../usePaddedAudio';
import {AudioServiceProvider} from '../../AudioServiceContext';

// ---------------------------------------------------------------------------
// AudioManager stub
// ---------------------------------------------------------------------------

interface CapturedFile {
  fileName: string;
  data: Uint8Array;
}

let lastCapturedFiles: CapturedFile[] = [];

class FakeAudioManager {
  ready = Promise.resolve();
  isPlaying = false;
  chartTime = 0;
  duration = 10;
  destroy = jest.fn();
  pause = jest.fn(async () => {});
  resume = jest.fn(async () => {});
  seekToChartTime = jest.fn(async () => {});
  setChartDelay = jest.fn();
  #volumes = new Map<string, number>();
  setVolume = jest.fn((trackName: string, volume: number) => {
    this.#volumes.set(trackName, volume);
  });
  // Mirrors the real manager: one track per audio file, defaulting to full
  // volume until something sets it.
  getVolume = jest.fn((trackName: string) => this.#volumes.get(trackName) ?? 1);
  trackNames: string[];

  constructor(audioFiles: CapturedFile[]) {
    lastCapturedFiles = audioFiles;
    this.trackNames = audioFiles.map(file =>
      file.fileName.replace(/\.wav$/, ''),
    );
  }
}

// jsdom has no OfflineAudioContext; `generateBeatClickTrackWav` (used inside
// `buildPaddedAudioManager` to synthesize the click stem) needs one. The
// click stem's actual content isn't under test here, so stub it out.
jest.mock('../../../../lib/preview/clickTrack', () => ({
  CLICK_TRACK_NAME: 'click',
  generateBeatClickTrackWav: jest.fn(async () => new Uint8Array(4)),
}));

jest.mock('../../../../lib/preview/audioManager', () => ({
  AudioManager: jest.fn().mockImplementation(function (
    this: unknown,
    audioFiles: CapturedFile[],
  ) {
    return new FakeAudioManager(audioFiles);
  }),
}));

// `require`, not `import`: the module has to load AFTER the jest.mock calls
// above are hoisted. Typed via `typeof import(...)` (a type-only position,
// so it adds no runtime import) to keep the signatures checked.
const {usePaddedAudio, buildPaddedAudioManager, anchorPadSamples} =
  require('../usePaddedAudio') as typeof import('../usePaddedAudio');

function makeChartDoc(): ChartDocument {
  const parsedChart = createEmptyChart({bpm: 120, resolution: 480});
  return {parsedChart, assets: []};
}

function interleavedPcm(
  frames: number,
  channels = 2,
  fill = 0.5,
): Float32Array {
  const out = new Float32Array(frames * channels);
  out.fill(fill);
  return out;
}

const AUDIO_META = {sampleRate: 8000, channels: 2};

describe('buildPaddedAudioManager — N-stem construction (plan 0074 Task 5a)', () => {
  beforeEach(() => {
    lastCapturedFiles = [];
  });

  it('produces one WAV per stem, correctly named, plus song.wav and click.wav', async () => {
    const chartDoc = makeChartDoc();
    const fullMix = interleavedPcm(100);
    const stems = [
      {
        name: 'drums',
        pcm: interleavedPcm(100),
        origin: 'ai-separated' as const,
      },
      {name: 'vocals', pcm: interleavedPcm(100), origin: 'chart-file' as const},
    ];

    await buildPaddedAudioManager(
      0,
      AUDIO_META,
      fullMix,
      stems,
      chartDoc,
      () => {},
    );

    const fileNames = lastCapturedFiles.map(f => f.fileName);
    expect(fileNames).toEqual(
      expect.arrayContaining([
        'song.wav',
        'drums.wav',
        'vocals.wav',
        'click.wav',
      ]),
    );
    expect(fileNames).toHaveLength(4);
  });

  it('produces only song.wav and click.wav for an empty stem list', async () => {
    const chartDoc = makeChartDoc();
    const fullMix = interleavedPcm(100);

    await buildPaddedAudioManager(
      0,
      AUDIO_META,
      fullMix,
      [],
      chartDoc,
      () => {},
    );

    const fileNames = lastCapturedFiles.map(f => f.fileName);
    expect(fileNames.sort()).toEqual(['click.wav', 'song.wav']);
  });

  it('pads every stem by the same sample count as the full mix', async () => {
    const chartDoc = makeChartDoc();
    const padSamples = 50;
    const fullMix = interleavedPcm(100);
    const stems = [
      {
        name: 'drums',
        pcm: interleavedPcm(100),
        origin: 'ai-separated' as const,
      },
      {name: 'vocals', pcm: interleavedPcm(100), origin: 'chart-file' as const},
    ];

    const {paddedFullMixPcm, paddedStems} = await buildPaddedAudioManager(
      padSamples,
      AUDIO_META,
      fullMix,
      stems,
      chartDoc,
      () => {},
    );

    const expectedLength = (100 + padSamples) * AUDIO_META.channels;
    expect(paddedFullMixPcm.length).toBe(expectedLength);
    for (const stem of paddedStems) {
      expect(stem.pcm.length).toBe(expectedLength);
    }
    // The padded region (leading `padSamples` frames) is silence for every
    // stem, matching the full mix.
    for (const stem of paddedStems) {
      for (let i = 0; i < padSamples * AUDIO_META.channels; i++) {
        expect(stem.pcm[i]).toBe(0);
      }
    }
  });

  it('round-trips origin metadata for each stem unchanged', async () => {
    const chartDoc = makeChartDoc();
    const fullMix = interleavedPcm(100);
    const stems = [
      {
        name: 'drums',
        pcm: interleavedPcm(100),
        origin: 'ai-separated' as const,
      },
      {name: 'guitar', pcm: interleavedPcm(100), origin: 'chart-file' as const},
    ];

    const {paddedStems} = await buildPaddedAudioManager(
      0,
      AUDIO_META,
      fullMix,
      stems,
      chartDoc,
      () => {},
    );

    expect(paddedStems.find((s: any) => s.name === 'drums')?.origin).toBe(
      'ai-separated',
    );
    expect(paddedStems.find((s: any) => s.name === 'guitar')?.origin).toBe(
      'chart-file',
    );
  });
});

describe('anchorPadSamples', () => {
  it('returns 0 for a null/non-positive anchor', () => {
    expect(anchorPadSamples(null, 8000)).toBe(0);
    expect(anchorPadSamples({ms: 0}, 8000)).toBe(0);
  });

  it('quantizes ms to samples at the given rate', () => {
    expect(anchorPadSamples({ms: 500}, 8000)).toBe(4000);
  });
});

describe('usePaddedAudio — hook contract (plan 0074 Task 5a)', () => {
  beforeEach(() => {
    lastCapturedFiles = [];
  });

  function wrapper({children}: {children: React.ReactNode}) {
    return <AudioServiceProvider>{children}</AudioServiceProvider>;
  }

  it('builds an AudioManager exposing the padded stem list with origins', async () => {
    const chartDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);
    const drumPcm = interleavedPcm(100);

    const {result} = renderHook(
      () =>
        usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems: [{name: 'drums', pcm: drumPcm, origin: 'ai-separated'}],
          onSongEnded: () => {},
        }),
      {wrapper},
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());

    expect(result.current.stems).toHaveLength(1);
    expect(result.current.stems[0]).toMatchObject({
      name: 'drums',
      origin: 'ai-separated',
    });
    expect(lastCapturedFiles.map(f => f.fileName)).toEqual(
      expect.arrayContaining(['song.wav', 'drums.wav', 'click.wav']),
    );
  });

  it('rebuilds and adds a track when a stem is added at runtime, preserving position', async () => {
    const chartDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);
    const drumPcm = interleavedPcm(100);
    const vocalsPcm = interleavedPcm(100);

    type StemsProp = {
      stems: {
        name: string;
        pcm: Float32Array;
        origin: 'chart-file' | 'ai-separated';
      }[];
    };

    const {result, rerender} = renderHook(
      ({stems}: StemsProp) =>
        usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems,
          onSongEnded: () => {},
        }),
      {
        wrapper,
        initialProps: {
          stems: [{name: 'drums', pcm: drumPcm, origin: 'ai-separated'}],
        } as StemsProp,
      },
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());
    const firstManager = result.current.audioManager;

    // Simulate mid-session playback position the swap must preserve.
    (firstManager as unknown as FakeAudioManager).isPlaying = true;
    (firstManager as unknown as FakeAudioManager).chartTime = 3.5;

    rerender({
      stems: [
        {name: 'drums', pcm: drumPcm, origin: 'ai-separated'},
        {name: 'vocals', pcm: vocalsPcm, origin: 'chart-file'},
      ],
    } as StemsProp);

    await waitFor(() => expect(result.current.stems).toHaveLength(2));

    expect(lastCapturedFiles.map(f => f.fileName)).toEqual(
      expect.arrayContaining([
        'song.wav',
        'drums.wav',
        'vocals.wav',
        'click.wav',
      ]),
    );

    const rebuiltManager = result.current
      .audioManager as unknown as FakeAudioManager;
    expect(rebuiltManager.seekToChartTime).toHaveBeenCalledWith(3.5);
    expect(rebuiltManager.resume).toHaveBeenCalled();
  });

  it('does not rebuild when a same-content stem array is passed by new reference', async () => {
    const chartDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);
    const drumPcm = interleavedPcm(100);

    const {result, rerender} = renderHook(
      ({stems}: {stems: AudioStemInput[]}) =>
        usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems,
          onSongEnded: () => {},
        }),
      {
        wrapper,
        initialProps: {
          stems: [{name: 'drums', pcm: drumPcm, origin: 'ai-separated'}],
        },
      },
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());
    const firstManager = result.current.audioManager;

    // New array literal, same name/origin/pcm reference — must not rebuild.
    rerender({
      stems: [{name: 'drums', pcm: drumPcm, origin: 'ai-separated'}],
    });

    // Give any accidental async rebuild a chance to happen.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.audioManager).toBe(firstManager);
  });

  it('migration call sites: single-stem shape still behaves like before', async () => {
    const chartDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);
    const drumPcm = interleavedPcm(100);

    const {result} = renderHook(
      () =>
        usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems: [{name: 'drums', pcm: drumPcm, origin: 'ai-separated'}],
          onSongEnded: () => {},
        }),
      {wrapper},
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());
    expect(result.current.fullMixPcm).not.toBeNull();
    expect(result.current.stems[0].pcm).not.toBeNull();
    expect(result.current.durationSeconds).toBe(10);
  });

  it('rebuilds without a removed stem', async () => {
    const chartDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);
    const drumPcm = interleavedPcm(100);
    const vocalsPcm = interleavedPcm(100);
    const drums = {
      name: 'drums',
      pcm: drumPcm,
      origin: 'ai-separated' as const,
    };
    const vocals = {
      name: 'vocals',
      pcm: vocalsPcm,
      origin: 'chart-file' as const,
    };

    const {result, rerender} = renderHook(
      ({stems}: {stems: AudioStemInput[]}) =>
        usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems,
          onSongEnded: () => {},
        }),
      {wrapper, initialProps: {stems: [drums, vocals]}},
    );

    await waitFor(() => expect(result.current.stems).toHaveLength(2));

    rerender({stems: [drums]});

    await waitFor(() => expect(result.current.stems).toHaveLength(1));
    expect(result.current.stems[0].name).toBe('drums');
    expect(lastCapturedFiles.map(f => f.fileName).sort()).toEqual([
      'click.wav',
      'drums.wav',
      'song.wav',
    ]);
  });

  it('rebuilds when the stems are reordered', async () => {
    const chartDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);
    const drums = {
      name: 'drums',
      pcm: interleavedPcm(100),
      origin: 'ai-separated' as const,
    };
    const vocals = {
      name: 'vocals',
      pcm: interleavedPcm(100),
      origin: 'chart-file' as const,
    };

    const {result, rerender} = renderHook(
      ({stems}: {stems: AudioStemInput[]}) =>
        usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems,
          onSongEnded: () => {},
        }),
      {wrapper, initialProps: {stems: [drums, vocals]}},
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());
    const firstManager = result.current.audioManager;

    rerender({stems: [vocals, drums]});

    await waitFor(() =>
      expect(result.current.audioManager).not.toBe(firstManager),
    );
    expect(result.current.stems.map(stem => stem.name)).toEqual([
      'vocals',
      'drums',
    ]);
  });

  it('carries per-track volumes onto the new manager before resuming', async () => {
    const chartDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);
    const drums = {
      name: 'drums',
      pcm: interleavedPcm(100),
      origin: 'ai-separated' as const,
    };
    const keys = {
      name: 'keys',
      pcm: interleavedPcm(100),
      origin: 'user-added' as const,
    };

    const {result, rerender} = renderHook(
      ({stems}: {stems: AudioStemInput[]}) =>
        usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems,
          onSongEnded: () => {},
        }),
      {wrapper, initialProps: {stems: [drums] as AudioStemInput[]}},
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());
    const firstManager = result.current
      .audioManager as unknown as FakeAudioManager;

    // What the mixer does when the user mutes the full mix and raises the
    // click, mid-playback.
    firstManager.setVolume('song', 0);
    firstManager.setVolume('click', 0.5);
    firstManager.isPlaying = true;

    rerender({stems: [drums, keys]});

    await waitFor(() => expect(result.current.stems).toHaveLength(2));
    const rebuilt = result.current.audioManager as unknown as FakeAudioManager;
    expect(rebuilt).not.toBe(firstManager);

    const volumeFor = (track: string) =>
      rebuilt.setVolume.mock.calls
        .filter(([name]) => name === track)
        .pop()?.[1];
    expect(volumeFor('song')).toBe(0);
    expect(volumeFor('click')).toBe(0.5);
    expect(volumeFor('drums')).toBe(1);

    // The muted track must be silent BEFORE playback resumes, otherwise it
    // blips at full volume on the new manager.
    const lastSongVolumeCall = rebuilt.setVolume.mock.invocationCallOrder
      .filter((_, i) => rebuilt.setVolume.mock.calls[i][0] === 'song')
      .pop() as number;
    expect(lastSongVolumeCall).toBeLessThan(
      rebuilt.resume.mock.invocationCallOrder[0],
    );
  });

  it('rebuilds when the audioAnchor changes with an unchanged (empty) stem list', async () => {
    const initialDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);

    const {result, rerender} = renderHook(
      ({chartDoc}) =>
        usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems: [],
          onSongEnded: () => {},
        }),
      {wrapper, initialProps: {chartDoc: initialDoc}},
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());
    const firstManager = result.current.audioManager;

    const anchoredDoc = setAudioAnchor(initialDoc, {tick: 480, ms: 500});
    rerender({chartDoc: anchoredDoc});

    await waitFor(() =>
      expect(result.current.audioManager).not.toBe(firstManager),
    );
  });
});
