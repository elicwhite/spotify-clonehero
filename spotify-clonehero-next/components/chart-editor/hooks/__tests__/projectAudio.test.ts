/**
 * The chart-package audio a `/chart-editor` project plays and exports
 * (plan 0076 item 18, contract point 2).
 *
 * `padPackageAudio` is the export half: when the chart carries an
 * `audioAnchor`, every note has moved by that much, so each of the package's
 * own files has to move with it. What must hold is that EVERY file comes back
 * (under its own name), each padded by exactly the anchor, and that a browser
 * with no Opus encoder still gets padded audio rather than silently falling
 * back to the unpadded originals.
 */

import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {
  decodeChartPackageAudio,
  packageHasDrumsAudio,
  padPackageAudio,
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
  interleaveAudioBuffer: jest.fn(),
}));

import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import {
  decodeAtRate,
  nativeDecodeRate,
} from '@/lib/audio-pipeline/decode-audio';
import {interleaveAudioBuffer} from '@/lib/drum-transcription/audio/decoder';

const mockOpus = encodePcmToOpus as jest.Mock;
const mockDecode = decodeAtRate as jest.Mock;
const mockNativeRate = nativeDecodeRate as jest.Mock;
const mockInterleave = interleaveAudioBuffer as jest.Mock;

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

describe('padPackageAudio', () => {
  it('returns every one of the package’s files, each padded by the anchor', async () => {
    const sources = await padPackageAudio(makePackage(), 100);
    expect(sources.map(s => s.fileName)).toEqual(['song.opus', 'guitar.opus']);
    for (const source of sources) {
      expect(source.data.byteLength).toBe((100 + 8) * channels);
    }
  });

  it('falls back to padded WAV when the browser has no Opus encoder', async () => {
    mockOpus.mockRejectedValue(new Error('no WebCodecs AudioEncoder'));
    const sources = await padPackageAudio(makePackage(), 100);
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
    const sources = await padPackageAudio(pkg, 10);
    expect(sources.map(s => s.fileName)).toEqual(['guitar.opus', 'drums.opus']);
  });

  it('exports only the package’s own audio, never a separated stem', async () => {
    // Separated stems are a mixing aid, not part of the chart. They never
    // reach here: `DecodedPackageAudio` carries the package's files alone,
    // and `useSeparatedStems` publishes the AI-separated ones elsewhere.
    const pkg = makePackage();
    const sources = await padPackageAudio(pkg, 10);
    expect(sources).toHaveLength(1 + pkg.stems.length);
  });
});

describe('decodeChartPackageAudio', () => {
  beforeEach(() => {
    mockDecode.mockResolvedValue({});
    mockNativeRate.mockReturnValue(48000);
    mockInterleave.mockImplementation(() => new Float32Array(4));
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

  it('promotes the first file when the package ships no `song`', async () => {
    const decoded = await decodeChartPackageAudio([
      {fileName: 'guitar.ogg', data: new Uint8Array([1])},
      {fileName: 'bass.ogg', data: new Uint8Array([2])},
    ]);
    expect(decoded.fullMixName).toBe('guitar');
    expect(decoded.stems.map(s => s.name)).toEqual(['bass']);
  });

  it('uniquifies files that share a basename, so neither is lost', async () => {
    const decoded = await decodeChartPackageAudio([
      {fileName: 'song.ogg', data: new Uint8Array([1])},
      {fileName: 'song.mp3', data: new Uint8Array([2])},
    ]);
    expect(decoded.fullMixName).toBe('song');
    expect(decoded.stems.map(s => s.name)).toEqual(['song-2']);
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

  it('is true when the promoted full mix names the drums', () => {
    expect(packageHasDrumsAudio({...makePackage(), fullMixName: 'drums'})).toBe(
      true,
    );
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
