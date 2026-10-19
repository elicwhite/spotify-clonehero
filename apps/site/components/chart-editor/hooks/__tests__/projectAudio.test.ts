/**
 * The chart-package audio a `/chart-editor` project plays and exports
 * (plan 0076 item 18, contract point 2).
 *
 * `shiftPackageAudio` is the export half: when the chart carries an
 * `audioAnchor`, every note has moved by that much, so each of the package's
 * own files has to move with it. What must hold is that EVERY file comes back
 * (under its own name), each padded by exactly the anchor, and that a browser
 * with no Opus encoder still gets padded audio rather than silently falling
 * back to the unpadded originals.
 */

import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {
  decodeChartPackageAudio,
  packageFiles,
  packageHasDrumsAudio,
  shiftPackageAudio,
  planExportAudio,
  PACKAGE_AUDIO_CHANNELS,
  type DecodedPackageAudio,
} from '../projectAudio';

jest.mock('../../../../lib/audio/opus-encoder', () => ({
  encodePcmToOpus: jest.fn(),
}));
jest.mock('../../../../lib/audio-pipeline/decode-audio', () => ({
  decodeAtRate: jest.fn(),
  nativeDecodeRate: jest.fn(),
}));
jest.mock('../../../../lib/drum-transcription/audio/decoder', () => ({
  interleaveAudioBufferYielding: jest.fn(),
}));

import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import {
  decodeAtRate,
  nativeDecodeRate,
} from '@/lib/audio-pipeline/decode-audio';
import {interleaveAudioBufferYielding} from '@/lib/drum-transcription/audio/decoder';

const mockOpus = encodePcmToOpus as jest.Mock;
const mockDecode = decodeAtRate as jest.Mock;
const mockNativeRate = nativeDecodeRate as jest.Mock;
const mockInterleave = interleaveAudioBufferYielding as jest.Mock;

/** jsdom's Blob has no `arrayBuffer()`; Node's does. */
(globalThis as unknown as {Blob: unknown}).Blob = require('buffer').Blob;

const channels = PACKAGE_AUDIO_CHANNELS;
const SAMPLE_RATE = 48000;

/** A two-file package: a `song` full mix plus one `guitar` stem. */
function makePackage(): DecodedPackageAudio {
  return {
    fullMixName: 'song',
    fullMixPcm: new Float32Array(8 * channels),
    stems: [
      {
        name: 'guitar',
        pcm: new Float32Array(8 * channels),
        origin: 'chart-file',
      },
    ],
    meta: {sampleRate: SAMPLE_RATE, channels},
  };
}

/** Frame count of an encoded WAV, read back off its own header. */
function wavFrames(data: ArrayBuffer): number {
  // 44-byte canonical header, then 16-bit samples.
  return (data.byteLength - 44) / 2 / channels;
}

beforeEach(() => {
  jest.clearAllMocks();
  // The encoder echoes back a byte per input float, so a padded input is
  // visibly longer than an unpadded one.
  mockOpus.mockImplementation(async (pcm: Float32Array) => new Uint8Array(pcm));
});

describe('shiftPackageAudio', () => {
  it('returns every one of the package’s files, each padded by the anchor', async () => {
    const sources = await shiftPackageAudio(makePackage(), 100);
    expect(sources.map(s => s.fileName)).toEqual(['song.opus', 'guitar.opus']);
    for (const source of sources) {
      expect(source.data.byteLength).toBe((100 + 8) * channels);
    }
  });

  it('falls back to padded WAV when the browser has no Opus encoder', async () => {
    mockOpus.mockRejectedValue(new Error('no WebCodecs AudioEncoder'));
    const sources = await shiftPackageAudio(makePackage(), 100);
    expect(sources.map(s => s.fileName)).toEqual(['song.wav', 'guitar.wav']);
    for (const source of sources) {
      expect(wavFrames(source.data)).toBe(100 + 8);
    }
  });

  it('names each file after the package file it came from', async () => {
    const pkg: DecodedPackageAudio = {
      fullMixName: 'guitar',
      fullMixPcm: new Float32Array(4 * channels),
      stems: [
        {
          name: 'drums',
          pcm: new Float32Array(4 * channels),
          origin: 'chart-file',
        },
      ],
      meta: {sampleRate: SAMPLE_RATE, channels},
    };
    const sources = await shiftPackageAudio(pkg, 10);
    expect(sources.map(s => s.fileName)).toEqual(['guitar.opus', 'drums.opus']);
  });

  it('exports only the package’s own audio, never a separated stem', async () => {
    // Separated stems are a mixing aid, not part of the chart. They never
    // reach here: `DecodedPackageAudio` carries the package's files alone,
    // and `useSeparatedStems` publishes the AI-separated ones elsewhere.
    const pkg = makePackage();
    const sources = await shiftPackageAudio(pkg, 10);
    expect(sources).toHaveLength(1 + pkg.stems.length);
  });

  it('exports a stems-only package as its stems, never the sum it draws', async () => {
    // The summed full mix is no file of the package. Shipping it would add
    // a `song` the game plays on top of every stem it was summed from.
    const pkg: DecodedPackageAudio = {
      fullMixName: null,
      fullMixPcm: new Float32Array(4 * channels),
      stems: ['drums', 'vocals'].map(name => ({
        name,
        pcm: new Float32Array(4 * channels),
        origin: 'chart-file' as const,
      })),
      meta: {sampleRate: SAMPLE_RATE, channels},
    };
    const sources = await shiftPackageAudio(pkg, 10);
    expect(sources.map(s => s.fileName)).toEqual(['drums.opus', 'vocals.opus']);
  });
});

describe('decodeChartPackageAudio', () => {
  beforeEach(() => {
    mockDecode.mockResolvedValue({});
    mockNativeRate.mockReturnValue(48000);
    mockInterleave.mockImplementation(async () => new Float32Array(4));
  });

  it('decodes every file at the full mix’s own native rate, and reports it', async () => {
    const decoded = await decodeChartPackageAudio([
      {fileName: 'guitar.ogg', data: new Uint8Array([1])},
      {fileName: 'song.ogg', data: new Uint8Array([2])},
    ]);
    // The rate is sniffed from the file that becomes the full mix, not from
    // whichever file happens to come first.
    expect(mockNativeRate).toHaveBeenCalledTimes(1);
    expect(mockNativeRate.mock.calls[0][0]).toEqual(new Uint8Array([2]));
    expect(decoded.meta).toEqual({sampleRate: 48000, channels});
    for (const call of mockDecode.mock.calls) expect(call[1]).toBe(48000);
  });

  it('promotes the `song` file to the full mix and keeps the rest as stems', async () => {
    const decoded = await decodeChartPackageAudio([
      {fileName: 'guitar.ogg', data: new Uint8Array([1])},
      {fileName: 'song.ogg', data: new Uint8Array([2])},
      {fileName: 'drums.ogg', data: new Uint8Array([3])},
    ]);
    expect(decoded.fullMixName).toBe('song');
    expect(decoded.stems.map(s => s.name)).toEqual(['guitar', 'drums']);
    expect(decoded.stems.every(s => s.origin === 'chart-file')).toBe(true);
  });

  it('keeps a single file as the full mix, whatever it is called', async () => {
    const decoded = await decodeChartPackageAudio([
      {fileName: 'guitar.ogg', data: new Uint8Array([1])},
    ]);
    expect(decoded.fullMixName).toBe('guitar');
    expect(decoded.stems).toEqual([]);
  });

  it('draws a package of stems with no `song` as their sum, and plays every one as a stem', async () => {
    // Each file decodes to a constant a tenth of its first byte, so the sum
    // is plain to read off.
    mockDecode.mockImplementation(async (data: Uint8Array) => ({tag: data[0]}));
    mockInterleave.mockImplementation(async ({tag}: {tag: number}) =>
      new Float32Array(4).fill(tag / 10),
    );

    const decoded = await decodeChartPackageAudio([
      {fileName: 'vocals.opus', data: new Uint8Array([1])},
      {fileName: 'drums.opus', data: new Uint8Array([2])},
      {fileName: 'bass.opus', data: new Uint8Array([3])},
    ]);

    // No file is promoted into the full-mix slot — `vocals` in it would be
    // the "song" on its own, and no longer the stem the lyrics row draws.
    expect(decoded.fullMixName).toBeNull();
    expect(decoded.stems.map(s => s.name)).toEqual(['vocals', 'drums', 'bass']);
    expect(decoded.stems.every(s => s.origin === 'chart-file')).toBe(true);
    expect(Array.from(decoded.fullMixPcm)).toEqual(
      Array(4).fill(expect.closeTo(0.6)),
    );
  });

  it('uniquifies files that share a basename, so neither is lost', async () => {
    const decoded = await decodeChartPackageAudio([
      {fileName: 'song.ogg', data: new Uint8Array([1])},
      {fileName: 'song.mp3', data: new Uint8Array([2])},
    ]);
    expect(decoded.fullMixName).toBe('song');
    expect(decoded.stems.map(s => s.name)).toEqual(['song-2']);
  });

  it('keeps a stem a stem when the `song` beside it fails to decode', async () => {
    mockDecode.mockRejectedValueOnce(new Error('bad audio'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const decoded = await decodeChartPackageAudio([
      {fileName: 'song.ogg', data: new Uint8Array([1])},
      {fileName: 'vocals.opus', data: new Uint8Array([2])},
    ]);
    // Two files is not a one-file package, so the vocals are not promoted to
    // be the song: they stay the stem the lyrics row draws.
    expect(decoded.fullMixName).toBeNull();
    expect(decoded.stems.map(s => s.name)).toEqual(['vocals']);
    warn.mockRestore();
  });

  it('skips a file it cannot decode rather than failing the load', async () => {
    mockDecode.mockRejectedValueOnce(new Error('bad audio'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const decoded = await decodeChartPackageAudio([
      {fileName: 'broken.ogg', data: new Uint8Array([1])},
      {fileName: 'song.ogg', data: new Uint8Array([2])},
    ]);
    expect(decoded.fullMixName).toBe('song');
    expect(decoded.stems).toHaveLength(0);
    warn.mockRestore();
  });

  it('rejects when nothing in the package decodes', async () => {
    mockDecode.mockRejectedValue(new Error('bad audio'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      decodeChartPackageAudio([
        {fileName: 'broken.ogg', data: new Uint8Array([1])},
      ]),
    ).rejects.toThrow(/Could not decode/);
    warn.mockRestore();
  });
});

describe('packageFiles', () => {
  it('lists the full-mix file first, then every stem', () => {
    expect(packageFiles(makePackage()).map(file => file.name)).toEqual([
      'song',
      'guitar',
    ]);
  });

  it('lists only the stems of a stems-only package, never its summed full mix', () => {
    const pkg: DecodedPackageAudio = {...makePackage(), fullMixName: null};
    expect(packageFiles(pkg).map(file => file.name)).toEqual(['guitar']);
  });
});

describe('packageHasDrumsAudio', () => {
  it('is true when a stem file names the drums', () => {
    const pkg = makePackage();
    pkg.stems.push({
      name: 'drums_1',
      pcm: new Float32Array(2),
      origin: 'chart-file',
    });
    expect(packageHasDrumsAudio(pkg)).toBe(true);
  });

  it('is true when the package’s one file names the drums', () => {
    expect(packageHasDrumsAudio({...makePackage(), fullMixName: 'drums'})).toBe(
      true,
    );
  });

  it('reads a stems-only package by its stems, since its full mix is no file', () => {
    const pkg: DecodedPackageAudio = {
      ...makePackage(),
      fullMixName: null,
      stems: [{name: 'drums', pcm: new Float32Array(2), origin: 'chart-file'}],
    };
    expect(packageHasDrumsAudio(pkg)).toBe(true);
    expect(packageHasDrumsAudio({...pkg, stems: []})).toBe(false);
  });

  it('is false for a package with no drums audio of its own', () => {
    expect(packageHasDrumsAudio(makePackage())).toBe(false);
  });
});

describe('encodeWavBlob header assumption', () => {
  it('writes the 44-byte canonical header this suite reads frames from', async () => {
    const blob = encodeWavBlob(new Float32Array(4 * channels), 44100, channels);
    expect(wavFrames(await blob.arrayBuffer())).toBe(4);
  });
});

describe('planExportAudio', () => {
  it('ships the package files as they are when nothing has shifted', () => {
    expect(planExportAudio(makePackage().meta, null)).toEqual({kind: 'raw'});
    expect(planExportAudio(makePackage().meta, {ms: 0})).toEqual({kind: 'raw'});
  });

  it('pads, quantized to the package’s own rate, when the chart has shifted', () => {
    expect(planExportAudio(makePackage().meta, {ms: 1000})).toEqual({
      kind: 'shifted',
      shiftSamples: SAMPLE_RATE,
    });
  });

  it('trims the front for a negative anchor', () => {
    // A chart whose audio already carried the silence — imported, or one of
    // ours opened again — and the user removed a bar of lead-in. The audio
    // has to lose that bar with the chart.
    expect(planExportAudio(makePackage().meta, {ms: -500})).toEqual({
      kind: 'shifted',
      shiftSamples: -SAMPLE_RATE / 2,
    });
  });

  it('needs no audio in memory to export a chart that never shifted', () => {
    expect(planExportAudio(null, null)).toEqual({kind: 'raw'});
  });

  it('refuses when the chart has shifted and the audio is not loaded', () => {
    // The editor opens before the song has decoded, and a decode can fail.
    // Exporting the files unpadded here would pair a chart moved by whole
    // bars with audio that never moved, and nothing downstream could tell.
    expect(planExportAudio(null, {ms: 1000})).toEqual({kind: 'blocked'});
    expect(planExportAudio(null, {ms: -1000})).toEqual({kind: 'blocked'});
  });
});
