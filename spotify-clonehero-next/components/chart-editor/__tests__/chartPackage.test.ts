/**
 * @jest-environment jsdom
 */
/**
 * The chart-package host boundary shared by `/chart-editor` and the
 * difficulty-generation routes: what a package's audio files become before
 * they reach `ChartEditor`.
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import type {Files} from '@/lib/preview/chorus-chart-processing';
import {
  chartPackageAudioBytes,
  prepareChartPackageAudio,
} from '../chartPackage';

const constructed: {stems: string[]; setChartDelay: jest.Mock}[] = [];
jest.mock('../../../lib/preview/audioManager', () => ({
  AudioManager: jest.fn().mockImplementation(function (
    this: any,
    audioFiles: {fileName: string}[],
  ) {
    this.ready = Promise.resolve();
    this.stems = audioFiles.map(f => f.fileName);
    this.setChartDelay = jest.fn();
    this.setVolume = jest.fn();
    this.destroy = jest.fn();
    constructed.push(this);
  }),
}));

// Only the WAV synthesis is stubbed (it needs an OfflineAudioContext jsdom
// doesn't have); the rest of the module, `clickTrackSignature` included, is
// pure and stays real.
jest.mock('../../../lib/preview/clickTrack', () => ({
  ...jest.requireActual('../../../lib/preview/clickTrack'),
  generateBeatClickTrackWav: jest.fn(async () => new Uint8Array([0])),
}));

const mixStemsToAudioBuffer = jest.fn(async (_stems: unknown[]) => ({
  sampleRate: 44100,
  numberOfChannels: 2,
  length: 1,
  getChannelData: () => new Float32Array([0]),
}));
jest.mock('../../../lib/audio-pipeline/lyrics-audio', () => ({
  mixStemsToAudioBuffer: (...args: unknown[]) =>
    (mixStemsToAudioBuffer as unknown as (...a: unknown[]) => unknown)(...args),
}));

class FakeAudioContext {
  async decodeAudioData(_buffer: ArrayBuffer) {
    return {
      numberOfChannels: 2,
      duration: 12,
      length: 4,
      sampleRate: 48000,
      getChannelData: (ch: number) =>
        new Float32Array([ch, ch + 1, ch + 2, ch + 3]),
    } as unknown as AudioBuffer;
  }
  async close() {}
}
(globalThis as unknown as {AudioContext: unknown}).AudioContext =
  FakeAudioContext;

// jsdom's Blob has no `arrayBuffer()`, which the WAV encode path reads back.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function () {
    return Promise.resolve(new ArrayBuffer(0));
  };
}

function chartDoc(offsetSeconds = 0): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.metadata.chart_offset = offsetSeconds;
  return {parsedChart: parsed, assets: []};
}

function audioFiles(): Files {
  return [{fileName: 'song.ogg', data: new Uint8Array([1, 2, 3])}];
}

beforeEach(() => {
  constructed.length = 0;
  mixStemsToAudioBuffer.mockClear();
});

describe('prepareChartPackageAudio', () => {
  it("registers a metronome click stem and applies the chart's delay to playback", async () => {
    const prepared = await prepareChartPackageAudio({
      chartDoc: chartDoc(0.75),
      audioFiles: audioFiles(),
      onPlaybackEnded: () => {},
    });

    expect(constructed).toHaveLength(1);
    expect(constructed[0].stems).toEqual(['song.ogg', 'click.wav']);
    expect(prepared.audioManager.setChartDelay).toHaveBeenCalledWith(0.75);
  });

  it("leaves the package's own audio list alone, so export and Chart Assist never see the click stem", async () => {
    const files = audioFiles();
    await prepareChartPackageAudio({
      chartDoc: chartDoc(),
      audioFiles: files,
      onPlaybackEnded: () => {},
    });

    expect(files.map(f => f.fileName)).toEqual(['song.ogg']);
  });

  it('decodes the first file for the waveform', async () => {
    const prepared = await prepareChartPackageAudio({
      chartDoc: chartDoc(),
      audioFiles: audioFiles(),
      onPlaybackEnded: () => {},
    });

    expect(prepared.audioChannels).toBe(2);
    expect(prepared.audioSampleRate).toBe(48000);
    expect(prepared.durationSeconds).toBe(12);
    // Interleaved: [L0, R0, L1, R1, ...]
    expect(Array.from(prepared.audioData ?? [])).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4,
    ]);
  });
});

describe('chartPackageAudioBytes', () => {
  it('hands a single-file package its bytes verbatim, so its fingerprint matches the same file elsewhere', async () => {
    const files = audioFiles();
    await expect(chartPackageAudioBytes(files)).resolves.toBe(files[0].data);
  });

  it('rejects a package with no audio', async () => {
    await expect(chartPackageAudioBytes([])).rejects.toThrow(/No audio files/);
  });

  it('drops a click track, so a lone real stem beside it is still passed through verbatim', async () => {
    const files: Files = [
      {fileName: 'song.ogg', data: new Uint8Array([1, 2, 3])},
      {fileName: 'click.wav', data: new Uint8Array([9])},
    ];
    await expect(chartPackageAudioBytes(files)).resolves.toBe(files[0].data);
    expect(mixStemsToAudioBuffer).not.toHaveBeenCalled();
  });

  it('keeps the click out of the mix a multi-stem package is summed into', async () => {
    await chartPackageAudioBytes([
      {fileName: 'guitar.ogg', data: new Uint8Array([1])},
      {fileName: 'click.ogg', data: new Uint8Array([9])},
      {fileName: 'drums.ogg', data: new Uint8Array([2])},
    ]);

    expect(mixStemsToAudioBuffer).toHaveBeenCalledTimes(1);
    expect(mixStemsToAudioBuffer.mock.calls[0][0]).toHaveLength(2);
  });

  it('rejects a package whose only audio is the click track', async () => {
    await expect(
      chartPackageAudioBytes([
        {fileName: 'click.wav', data: new Uint8Array([9])},
      ]),
    ).rejects.toThrow(/No audio files/);
  });
});
