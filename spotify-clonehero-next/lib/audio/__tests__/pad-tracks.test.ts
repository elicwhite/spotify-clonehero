/**
 * The pure padding half of applying leading silence
 * (`lib/audio/pad-tracks.ts`). Unit-testable with no worker: the worker is
 * only where this runs, not what it does.
 */

import {padTracks, type PadProgress} from '../pad-tracks';

const CHANNELS = 2;

/** Interleaved stereo ramp, `frames` frames long. */
function ramp(frames: number): Float32Array {
  const pcm = new Float32Array(frames * CHANNELS);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i % 100) / 200;
  return pcm;
}

describe('padTracks', () => {
  it('prepends silence to every track, in order', () => {
    const tracks = [
      {name: 'song', pcm: ramp(1000)},
      {name: 'drums', pcm: ramp(1000)},
    ];
    const padded = padTracks(tracks, {padSamples: 500, channels: CHANNELS});

    expect(padded.map(t => t.name)).toEqual(['song', 'drums']);
    for (const track of padded) {
      expect(track.paddedPcm.length).toBe((1000 + 500) * CHANNELS);
      // The pad region is digital silence and the tail is the original.
      expect(track.paddedPcm.slice(0, 500 * CHANNELS).every(s => s === 0)).toBe(
        true,
      );
      expect(track.paddedPcm[500 * CHANNELS + 1]).toBeCloseTo(
        tracks[0].pcm[1],
        6,
      );
    }
  });

  it('leaves the PCM untouched (same reference) at a zero pad', () => {
    const pcm = ramp(10);
    const [padded] = padTracks([{name: 'song', pcm}], {
      padSamples: 0,
      channels: CHANNELS,
    });
    expect(padded.paddedPcm).toBe(pcm);
  });

  it('never mutates the source PCM', () => {
    const pcm = ramp(10);
    const before = Float32Array.from(pcm);
    padTracks([{name: 'song', pcm}], {padSamples: 7, channels: CHANNELS});
    expect(Array.from(pcm)).toEqual(Array.from(before));
  });

  it('reports one progress event per finished track', () => {
    const seen: PadProgress[] = [];
    padTracks(
      [
        {name: 'song', pcm: ramp(4)},
        {name: 'drums', pcm: ramp(4)},
        {name: 'bass', pcm: ramp(4)},
      ],
      {padSamples: 1, channels: CHANNELS},
      p => seen.push(p),
    );
    expect(seen).toEqual([
      {completed: 1, total: 3, name: 'song'},
      {completed: 2, total: 3, name: 'drums'},
      {completed: 3, total: 3, name: 'bass'},
    ]);
  });

  it('pads nothing for an empty track list', () => {
    expect(padTracks([], {padSamples: 100, channels: CHANNELS})).toEqual([]);
  });
});
