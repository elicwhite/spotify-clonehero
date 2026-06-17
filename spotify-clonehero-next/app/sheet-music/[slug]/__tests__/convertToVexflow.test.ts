import convertToVexFlow from '../convertToVexflow';
import {tickToMs} from '@/lib/chart-utils/tickToMs';
import {
  buildPracticeChart,
  type PracticeChartFillNote,
} from '@/lib/drum-fills/practice/practiceChart';
import type {BackingPattern} from '@/lib/drum-fills/practice/backingTrack';

const PATTERN: BackingPattern = {
  groove: [
    {beatOffset: 0, lane: 'kick'},
    {beatOffset: 1, lane: 'snare'},
    {beatOffset: 2, lane: 'kick'},
    {beatOffset: 3, lane: 'snare'},
    {beatOffset: 0, lane: 'hat'},
    {beatOffset: 1, lane: 'hat'},
    {beatOffset: 2, lane: 'hat'},
    {beatOffset: 3, lane: 'hat'},
  ],
  beatsPerBar: 4,
  grooveBars: 2,
  fillBars: 1,
  click: true,
};

// Irregular offsets (dotted-eighth / off-grid gaps) so some notes have a
// duration that is not a single atomic value and must be split by
// processCompositeDuration — the path that used to zero out the onset's time.
const FILL_NOTES: PracticeChartFillNote[] = [
  {beatOffset: 0, lane: 'red', isCymbal: false},
  // 0.625-beat gap (120 ticks @ res 192) is not a single atomic duration, so
  // processCompositeDuration must split it — the path that zeroed the onset.
  {beatOffset: 0.625, lane: 'yellow', isCymbal: false},
  {beatOffset: 1.5, lane: 'blue', isCymbal: false},
  {beatOffset: 2.0, lane: 'green', isCymbal: false},
  {beatOffset: 3.0, lane: 'green', isCymbal: true},
];

describe('convertToVexFlow note timing', () => {
  const bundle = buildPracticeChart({
    pattern: PATTERN,
    bpm: 120,
    fillNotes: FILL_NOTES,
  });
  const measures = convertToVexFlow(bundle.chart, bundle.track);
  const allNotes = measures.flatMap(m => m.notes);
  const playableNotes = allNotes.filter(n => !n.isRest);

  it('produces notes', () => {
    expect(playableNotes.length).toBeGreaterThan(0);
  });

  it('keeps every playable note onset at its true chart time (never zeroed)', () => {
    // Regression for the playhead "teleport on rests" bug: composite-duration
    // splitting used to stamp the onset piece with tick/ms 0, giving a
    // notehead a real x but a time of 0.
    for (const note of playableNotes) {
      if (note.tick === 0) continue; // a genuine note at tick 0 is allowed
      expect(note.ms).toBeGreaterThan(0);
      expect(note.ms).toBeCloseTo(tickToMs(bundle.chart, note.tick));
    }
  });

  it('emits playable-note times in non-decreasing order', () => {
    const times = playableNotes.map(n => n.ms);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });
});
