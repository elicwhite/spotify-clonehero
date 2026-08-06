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
import {
  AudioServiceProvider,
  useAudioServiceContext,
} from '../../AudioServiceContext';

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

// The pad/encode worker client, wrapped so tests can count how many times a
// build actually encoded. The real implementation runs inline here (jsdom
// has no Worker), so results stay real; only the call count is observed.
const encodeCalls = {count: 0};
jest.mock('../../../../lib/audio/pad-encode-client', () => {
  const actual = jest.requireActual('../../../../lib/audio/pad-encode-client');
  return {
    ...actual,
    padAndEncodeTracks: jest.fn((tracks: unknown, options: unknown) => {
      encodeCalls.count++;
      return actual.padAndEncodeTracks(tracks, options);
    }),
  };
});

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

  it('names the full mix after the file it came from', async () => {
    // A package with no `song` file promotes one of its own (here guitar)
    // into the full-mix slot; the mixer row and its WAV take that name, so
    // the row isn't labelled "song" while playing guitar.
    await buildPaddedAudioManager(
      0,
      AUDIO_META,
      interleavedPcm(100),
      [{name: 'bass', pcm: interleavedPcm(100), origin: 'chart-file' as const}],
      makeChartDoc(),
      () => {},
      'guitar',
    );

    const fileNames = lastCapturedFiles.map(f => f.fileName);
    expect(fileNames.sort()).toEqual(['bass.wav', 'click.wav', 'guitar.wav']);
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
    expect(paddedFullMixPcm?.length).toBe(expectedLength);
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

describe('buildPaddedAudioManager — a project with no audio', () => {
  beforeEach(() => {
    lastCapturedFiles = [];
  });

  it('builds the click alone, spanning the requested silent duration', async () => {
    const chartDoc = makeChartDoc();
    const {audioManager, paddedFullMixPcm, paddedStems} =
      await buildPaddedAudioManager(
        0,
        AUDIO_META,
        null,
        [],
        chartDoc,
        () => {},
        'song',
        42,
      );

    expect(lastCapturedFiles.map(f => f.fileName)).toEqual(['click.wav']);
    expect(audioManager.trackNames).toEqual(['click']);
    expect(paddedFullMixPcm).toBeNull();
    expect(paddedStems).toEqual([]);
  });

  it('starts the click audible, since it is the only thing to hear', async () => {
    const chartDoc = makeChartDoc();
    const silent = await buildPaddedAudioManager(
      0,
      AUDIO_META,
      null,
      [],
      chartDoc,
      () => {},
      'song',
      42,
    );
    expect(silent.audioManager.setVolume).toHaveBeenCalledWith('click', 0.7);

    const withAudio = await buildPaddedAudioManager(
      0,
      AUDIO_META,
      interleavedPcm(100),
      [],
      chartDoc,
      () => {},
    );
    expect(withAudio.audioManager.setVolume).toHaveBeenCalledWith('click', 0);
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

describe('usePaddedAudio — rebuild gating covers the full mix and the length', () => {
  function wrapper({children}: {children: React.ReactNode}) {
    return <AudioServiceProvider>{children}</AudioServiceProvider>;
  }

  it('rebuilds when a silent project gains its first audio', async () => {
    const chartDoc = makeChartDoc();
    const fullMixPcm = interleavedPcm(100);

    type Props = {
      fullMixPcm: Float32Array | null;
      silentDurationSeconds: number | undefined;
    };
    const {result, rerender} = renderHook(
      ({fullMixPcm: pcm, silentDurationSeconds}: Props) =>
        usePaddedAudio({
          chartDoc,
          audioMeta: pcm ? AUDIO_META : null,
          fullMixPcm: pcm,
          stems: [],
          silentDurationSeconds,
          onSongEnded: () => {},
        }),
      {
        wrapper,
        initialProps: {
          fullMixPcm: null,
          silentDurationSeconds: 300,
        } as Props,
      },
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());
    const silentManager = result.current.audioManager;
    expect(silentManager?.trackNames).toEqual(['click']);

    rerender({fullMixPcm, silentDurationSeconds: undefined});

    await waitFor(() =>
      expect(result.current.audioManager).not.toBe(silentManager),
    );
    expect(result.current.audioManager?.trackNames).toEqual(['song', 'click']);
  });

  it('rebuilds when only the silent duration changes, and not when nothing does', async () => {
    const chartDoc = makeChartDoc();
    const {result, rerender} = renderHook(
      ({seconds}: {seconds: number}) =>
        usePaddedAudio({
          chartDoc,
          audioMeta: null,
          fullMixPcm: null,
          stems: [],
          silentDurationSeconds: seconds,
          onSongEnded: () => {},
        }),
      {wrapper, initialProps: {seconds: 300}},
    );

    await waitFor(() => expect(result.current.audioManager).not.toBeNull());
    const first = result.current.audioManager;

    rerender({seconds: 300});
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.audioManager).toBe(first);

    rerender({seconds: 200});
    await waitFor(() => expect(result.current.audioManager).not.toBe(first));
  });
});

describe('usePaddedAudio — pre-padding for an anchor change', () => {
  function wrapper({children}: {children: React.ReactNode}) {
    return <AudioServiceProvider>{children}</AudioServiceProvider>;
  }

  const fullMixPcm = interleavedPcm(100);
  const drumPcm = interleavedPcm(100);
  const STEMS = [
    {name: 'drums', pcm: drumPcm, origin: 'ai-separated' as const},
  ];

  /** Renders the hook plus a handle on the service it publishes to. */
  function renderWithService() {
    return renderHook(
      ({chartDoc}: {chartDoc: ChartDocument}) => ({
        audio: usePaddedAudio({
          chartDoc,
          audioMeta: AUDIO_META,
          fullMixPcm,
          stems: STEMS,
          onSongEnded: () => {},
        }),
        service: useAudioServiceContext(),
      }),
      {wrapper, initialProps: {chartDoc: makeChartDoc()}},
    );
  }

  beforeEach(() => {
    encodeCalls.count = 0;
    lastCapturedFiles = [];
  });

  it('publishes a pre-pad function while mounted and withdraws it on unmount', async () => {
    const {result, unmount} = renderWithService();
    await waitFor(() =>
      expect(result.current.audio.audioManager).not.toBeNull(),
    );
    const service = result.current.service;

    expect(service.getPadAudioAhead()).not.toBeNull();
    unmount();
    expect(service.getPadAudioAhead()).toBeNull();
  });

  it('installs nothing by itself: the manager only changes when the anchor does', async () => {
    const {result} = renderWithService();
    await waitFor(() =>
      expect(result.current.audio.audioManager).not.toBeNull(),
    );
    const before = result.current.audio.audioManager;

    await act(async () => {
      await result.current.service.getPadAudioAhead()!(500, {});
    });

    expect(result.current.audio.audioManager).toBe(before);
    expect(result.current.audio.fullMixPcm?.length).toBe(100 * 2);
  });

  it('reuses the pre-padded audio for the build that matches it', async () => {
    const {result, rerender} = renderWithService();
    await waitFor(() =>
      expect(result.current.audio.audioManager).not.toBeNull(),
    );

    await act(async () => {
      await result.current.service.getPadAudioAhead()!(500, {});
    });
    const encodesBeforeRebuild = encodeCalls.count;

    // The same 500 ms the pre-pad was asked for, quantized identically.
    rerender({chartDoc: setAudioAnchor(makeChartDoc(), {ms: 500, tick: 0})});
    await waitFor(() =>
      expect(result.current.audio.fullMixPcm?.length).toBe((100 + 4000) * 2),
    );

    expect(encodeCalls.count).toBe(encodesBeforeRebuild);
    expect(result.current.audio.stems[0].pcm.length).toBe((100 + 4000) * 2);
  });

  it('encodes again when the pad it prepared for is no longer the pad needed', async () => {
    const {result, rerender} = renderWithService();
    await waitFor(() =>
      expect(result.current.audio.audioManager).not.toBeNull(),
    );

    // A tempo edit during the run changes the bar length, so the anchor the
    // command installs (250 ms) is not the one this encoded for (500 ms).
    await act(async () => {
      await result.current.service.getPadAudioAhead()!(500, {});
    });
    const encodesBeforeRebuild = encodeCalls.count;

    rerender({chartDoc: setAudioAnchor(makeChartDoc(), {ms: 250, tick: 0})});
    await waitFor(() =>
      expect(result.current.audio.fullMixPcm?.length).toBe((100 + 2000) * 2),
    );

    expect(encodeCalls.count).toBe(encodesBeforeRebuild + 1);
  });

  it('drops a claimed pre-pad, so a later build never picks up a stale one', async () => {
    const {result, rerender} = renderWithService();
    await waitFor(() =>
      expect(result.current.audio.audioManager).not.toBeNull(),
    );

    await act(async () => {
      await result.current.service.getPadAudioAhead()!(500, {});
    });

    rerender({chartDoc: setAudioAnchor(makeChartDoc(), {ms: 500, tick: 0})});
    await waitFor(() =>
      expect(result.current.audio.fullMixPcm?.length).toBe((100 + 4000) * 2),
    );
    const afterFirst = encodeCalls.count;

    // Back to no silence, then to the same 500 ms anchor again: the second
    // trip has to encode for itself.
    rerender({chartDoc: makeChartDoc()});
    await waitFor(() =>
      expect(result.current.audio.fullMixPcm?.length).toBe(100 * 2),
    );
    rerender({chartDoc: setAudioAnchor(makeChartDoc(), {ms: 500, tick: 0})});
    await waitFor(() =>
      expect(result.current.audio.fullMixPcm?.length).toBe((100 + 4000) * 2),
    );

    expect(encodeCalls.count).toBe(afterFirst + 2);
  });

  it('reports pad progress per track', async () => {
    const {result} = renderWithService();
    await waitFor(() =>
      expect(result.current.audio.audioManager).not.toBeNull(),
    );

    const seen: Array<[number, string]> = [];
    await act(async () => {
      await result.current.service.getPadAudioAhead()!(500, {
        onProgress: (fraction, detail) => seen.push([fraction, detail]),
      });
    });

    // The full mix plus one stem.
    expect(seen).toEqual([
      [0.5, '1 of 2'],
      [1, '2 of 2'],
    ]);
  });
});
