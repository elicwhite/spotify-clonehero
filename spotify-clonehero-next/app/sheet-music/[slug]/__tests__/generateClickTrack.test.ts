/**
 * The sheet-music click's four subdivisions are rendered as four buffers in
 * one track, at unit amplitude, so the faders are gain writes rather than a
 * re-render (and, before that, a full AudioManager rebuild).
 *
 * What has to hold: buffer order matches the voice list the caller passed
 * (buffer i is voices[i], which is what `setBufferGain` addresses), a voice
 * at zero costs nothing, and each voice carries only its own events.
 */

import type {Measure} from '../convertToVexflow';
import {
  activeClickVoices,
  generateClickEventsFromMeasures,
  generateClickVoicePcm,
} from '../generateClickTrack';

// jsdom has no OfflineAudioContext. The click sample's shape isn't under test
// here — its placement and amplitude are — so it stands in as a single
// full-scale sample, making every event one nonzero frame.
jest.mock('../../../../lib/preview/clickTrack', () => ({
  ...jest.requireActual('../../../../lib/preview/clickTrack'),
  generateClickSample: jest.fn(async () => Float32Array.from([1])),
}));

const SAMPLE_RATE = 8000;

/** One 4/4 measure, 2000ms long at 480 ticks per quarter. */
function measure(index: number): Measure {
  const startTick = index * 1920;
  const startMs = index * 2000;
  return {
    startTick,
    endTick: startTick + 1920,
    startMs,
    endMs: startMs + 2000,
    beats: [0, 480, 960, 1440].map(offset => ({
      startTick: startTick + offset,
      endTick: startTick + offset + 480,
    })),
  } as Measure;
}

/** Sample indexes carrying a click, in order. */
function hits(samples: Float32Array): number[] {
  const found: number[] = [];
  samples.forEach((value, index) => {
    if (value !== 0) found.push(index);
  });
  return found;
}

describe('activeClickVoices', () => {
  it('keeps only audible voices, in buffer order', () => {
    expect(
      activeClickVoices({
        wholeNote: 1,
        quarterNote: 0.75,
        eighthNote: 0.1,
        tripletNote: 0,
      }),
    ).toEqual(['wholeNote', 'quarterNote', 'eighthNote']);

    expect(
      activeClickVoices({
        wholeNote: 0,
        quarterNote: 0,
        eighthNote: 0.5,
        tripletNote: 0.5,
      }),
    ).toEqual(['eighthNote', 'tripletNote']);
  });
});

describe('generateClickEventsFromMeasures', () => {
  it('puts the downbeat, the other beats and the subdivisions on their own voices', () => {
    const events = generateClickEventsFromMeasures([measure(0)]);
    const byVoice = events.reduce<Record<string, number[]>>((acc, event) => {
      (acc[event.voice] ??= []).push(Math.round(event.timeMs));
      return acc;
    }, {});

    expect(byVoice['wholeNote']).toEqual([0]);
    expect(byVoice['quarterNote']).toEqual([500, 1000, 1500]);
    // Subdivisions only sit between beats, so the last beat has none.
    expect(byVoice['eighthNote']).toEqual([250, 750, 1250]);
    expect(byVoice['tripletNote']).toEqual([167, 333, 667, 833, 1167, 1333]);
  });
});

describe('generateClickVoicePcm', () => {
  it('returns one unit-amplitude buffer per voice, in the order given', async () => {
    const voices = ['wholeNote', 'quarterNote'] as const;
    const buffers = await generateClickVoicePcm([measure(0)], voices);

    expect(buffers).toHaveLength(2);
    expect(buffers.map(b => b.sampleRate)).toEqual([SAMPLE_RATE, SAMPLE_RATE]);

    // Buffer 0 is the downbeat alone; buffer 1 is the other three beats.
    expect(hits(buffers[0].samples)).toEqual([0]);
    expect(hits(buffers[1].samples)).toEqual([4000, 8000, 12000]);

    // Unit amplitude: loudness comes from `setBufferGain`, not the samples.
    expect(buffers[1].samples[4000]).toBe(1);
  });

  it('does not render a voice the caller left out', async () => {
    const buffers = await generateClickVoicePcm([measure(0)], ['tripletNote']);
    expect(buffers).toHaveLength(1);
    expect(hits(buffers[0].samples)).toEqual([
      1333, 2666, 5333, 6666, 9333, 10666,
    ]);
  });

  it('costs one frame when nothing is audible, so the track still exists', async () => {
    const buffers = await generateClickVoicePcm([measure(0)], []);
    expect(buffers).toHaveLength(1);
    expect(buffers[0].samples).toHaveLength(1);
    expect(buffers[0].samples[0]).toBe(0);
  });

  it('shifts every voice by the chart delay and lengthens the buffer to fit', async () => {
    const delayMs = 1000;
    const buffers = await generateClickVoicePcm(
      [measure(0)],
      ['wholeNote'],
      delayMs,
    );

    expect(buffers[0].samples).toHaveLength(
      Math.ceil((SAMPLE_RATE * (2000 + delayMs)) / 1000),
    );
    expect(hits(buffers[0].samples)).toEqual([SAMPLE_RATE]);
  });

  it('spans every measure', async () => {
    const buffers = await generateClickVoicePcm(
      [measure(0), measure(1)],
      ['wholeNote'],
    );
    expect(hits(buffers[0].samples)).toEqual([0, 16000]);
  });

  it('refuses to render without measures', async () => {
    await expect(generateClickVoicePcm([], ['wholeNote'])).rejects.toThrow(
      'No measures provided',
    );
  });
});
