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

jest.mock('../../../lib/preview/clickTrack', () => ({
  CLICK_TRACK_NAME: 'click',
  generateBeatClickTrackWav: jest.fn(async () => new Uint8Array([0])),
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
});
