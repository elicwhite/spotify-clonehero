import {
  backingEventsForLoop,
  backingWavSampleCount,
  BACKING_SAMPLE_RATE,
} from '@/lib/drum-fills/practice/backingAudio';
import type {BackingPattern} from '@/lib/drum-fills/practice/backingTrack';
import {buildPracticeChart} from '@/lib/drum-fills/practice/practiceChart';
import {noteTypes} from '@/lib/chart-edit/types';

const PATTERN: BackingPattern = {
  groove: [
    {beatOffset: 0, lane: 'kick'},
    {beatOffset: 1, lane: 'snare'},
    {beatOffset: 2, lane: 'kick'},
    {beatOffset: 3, lane: 'snare'},
    {beatOffset: 0.5, lane: 'hat'},
  ],
  beatsPerBar: 4,
  grooveBars: 2,
  fillBars: 1,
  click: true,
};

describe('backingEventsForLoop', () => {
  it('emits groove hits at their chart offsets and leaves the fill bars silent', () => {
    const events = backingEventsForLoop(PATTERN, 120); // 500ms/beat
    // Groove spans beats [0, 8) → [0s, 4s); fill bar is [4s, 6s).
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(e => e.time < 4.0)).toBe(true);

    const kicks = events.filter(e => e.voice === 'kick').map(e => e.time);
    expect(kicks.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    const hats = events.filter(e => e.voice === 'hat').map(e => e.time);
    expect(hats).toEqual([0.25, 2.25]);
  });

  it('clicks on every groove beat', () => {
    const events = backingEventsForLoop(PATTERN, 120);
    const clicks = events.filter(e => e.voice === 'click').map(e => e.time);
    expect(clicks.sort((a, b) => a - b)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5,
    ]);
  });

  it('returns empty for a degenerate pattern', () => {
    expect(
      backingEventsForLoop({...PATTERN, grooveBars: 0, fillBars: 0}, 120),
    ).toEqual([]);
  });

  it('aligns exactly with the practice chart: every kit event matches a chart groove note ms time', () => {
    // The core invariant of the synth path: the backing WAV is rendered at the
    // practice chart's exact timing with chartDelay 0, so AudioManager's
    // chartTime is chart time. Kit events (kick/snare/hat) must land on the
    // same ms offsets as the chart's groove notes.
    const bpm = 137; // deliberately not a round number
    const bundle = buildPracticeChart({pattern: PATTERN, bpm, fillNotes: []});
    const events = backingEventsForLoop(PATTERN, bpm);

    const voiceToType = {
      kick: noteTypes.kick,
      snare: noteTypes.redDrum,
      hat: noteTypes.yellowDrum,
    } as const;

    const chartNotes = bundle.track.noteEventGroups.flat();
    for (const event of events) {
      const voice = event.voice;
      if (voice === 'click') continue;
      const match = chartNotes.find(
        n =>
          n.type === voiceToType[voice] &&
          Math.abs(n.msTime - event.time * 1000) < 1e-6,
      );
      expect(match).toBeDefined();
    }
    // And every chart groove note has a corresponding audio event.
    const kitEvents = events.filter(e => e.voice !== 'click');
    expect(kitEvents.length).toBe(chartNotes.length);
  });
});

describe('backingWavSampleCount', () => {
  it('spans exactly one loop (groove + fill bars)', () => {
    // 3 bars * 4 beats * 0.5s = 6s.
    expect(backingWavSampleCount(PATTERN, 120)).toBe(
      Math.ceil(6 * BACKING_SAMPLE_RATE),
    );
  });

  it('matches the practice chart loop end (chartTime alignment at delay 0)', () => {
    const bpm = 92;
    const bundle = buildPracticeChart({pattern: PATTERN, bpm, fillNotes: []});
    const samples = backingWavSampleCount(PATTERN, bpm);
    expect(samples / BACKING_SAMPLE_RATE).toBeCloseTo(
      bundle.fillEndMs / 1000,
      3,
    );
  });

  it('respects a custom sample rate', () => {
    expect(backingWavSampleCount(PATTERN, 120, 8000)).toBe(Math.ceil(6 * 8000));
  });
});
