/**
 * The pure pad + WAV-encode half of applying leading silence
 * (`lib/audio/pad-encode.ts`). Unit-testable with no worker: the worker is
 * only where this runs, not what it does.
 */

import {padAndEncode, type PadEncodeProgress} from '../pad-encode';

const SAMPLE_RATE = 44100;
const CHANNELS = 2;

/** Interleaved stereo ramp, `frames` frames long. */
function ramp(frames: number): Float32Array {
  const pcm = new Float32Array(frames * CHANNELS);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i % 100) / 200;
  return pcm;
}

function wavDataLength(wav: Uint8Array): number {
  return new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(
    40,
    true,
  );
}

describe('padAndEncode', () => {
  it('prepends silence and encodes one WAV per track, in order', () => {
    const tracks = [
      {name: 'song', pcm: ramp(1000)},
      {name: 'drums', pcm: ramp(1000)},
    ];
    const encoded = padAndEncode(tracks, {
      padSamples: 500,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
    });

    expect(encoded.map(t => t.name)).toEqual(['song', 'drums']);
    for (const track of encoded) {
      expect(track.paddedPcm.length).toBe((1000 + 500) * CHANNELS);
      // The pad region is digital silence and the tail is the original.
      expect(track.paddedPcm.slice(0, 500 * CHANNELS).every(s => s === 0)).toBe(
        true,
      );
      expect(track.paddedPcm[500 * CHANNELS + 1]).toBeCloseTo(
        tracks[0].pcm[1],
        6,
      );
      // 16-bit samples, plus the 44-byte canonical header.
      expect(wavDataLength(track.wav)).toBe(track.paddedPcm.length * 2);
      expect(track.wav.length).toBe(44 + track.paddedPcm.length * 2);
    }
  });

  it('leaves the PCM untouched (same reference) at a zero pad', () => {
    const pcm = ramp(10);
    const [encoded] = padAndEncode([{name: 'song', pcm}], {
      padSamples: 0,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
    });
    expect(encoded.paddedPcm).toBe(pcm);
  });

  it('never mutates the source PCM', () => {
    const pcm = ramp(10);
    const before = Float32Array.from(pcm);
    padAndEncode([{name: 'song', pcm}], {
      padSamples: 7,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
    });
    expect(Array.from(pcm)).toEqual(Array.from(before));
  });

  it('reports one progress event per finished track', () => {
    const seen: PadEncodeProgress[] = [];
    padAndEncode(
      [
        {name: 'song', pcm: ramp(4)},
        {name: 'drums', pcm: ramp(4)},
        {name: 'bass', pcm: ramp(4)},
      ],
      {padSamples: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS},
      p => seen.push(p),
    );
    expect(seen).toEqual([
      {completed: 1, total: 3, name: 'song'},
      {completed: 2, total: 3, name: 'drums'},
      {completed: 3, total: 3, name: 'bass'},
    ]);
  });

  it('encodes nothing for an empty track list', () => {
    expect(
      padAndEncode([], {
        padSamples: 100,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
      }),
    ).toEqual([]);
  });
});
