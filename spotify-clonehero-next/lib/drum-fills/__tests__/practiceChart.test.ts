import {noteFlags, noteTypes} from '@/lib/chart-edit/types';
import type {BackingPattern} from '@/lib/drum-fills/practice/backingTrack';
import {
  buildPracticeChart,
  fillNotesToBeatOffsets,
  PRACTICE_CHART_RESOLUTION,
  type PracticeChartFillNote,
} from '@/lib/drum-fills/practice/practiceChart';

const RES = PRACTICE_CHART_RESOLUTION;

// A 4/4 backbeat: kick on 1 & 3, snare on 2 & 4, hat on every beat.
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

// A 16th-note snare/tom run across the fill bar.
const FILL_NOTES: PracticeChartFillNote[] = [
  {beatOffset: 0, lane: 'red', isCymbal: false},
  {beatOffset: 0.5, lane: 'yellow', isCymbal: false},
  {beatOffset: 1, lane: 'blue', isCymbal: false},
  {beatOffset: 2, lane: 'green', isCymbal: false},
  {beatOffset: 3.5, lane: 'green', isCymbal: true},
];

function allNotes(bundle: ReturnType<typeof buildPracticeChart>) {
  return bundle.track.noteEventGroups.flat();
}

describe('buildPracticeChart', () => {
  it('authors the chart at tick 0 with one tempo and the pattern time signature', () => {
    const bundle = buildPracticeChart({
      pattern: PATTERN,
      bpm: 120,
      fillNotes: FILL_NOTES,
    });
    expect(bundle.chart.resolution).toBe(RES);
    expect(bundle.chart.tempos).toEqual([
      {tick: 0, beatsPerMinute: 120, msTime: 0},
    ]);
    expect(bundle.chart.timeSignatures).toHaveLength(1);
    expect(bundle.chart.timeSignatures[0]).toMatchObject({
      tick: 0,
      numerator: 4,
      denominator: 4,
    });
    expect(bundle.grooveStartMs).toBe(0);
  });

  it('places groove notes at their chart offsets across every groove bar', () => {
    const bundle = buildPracticeChart({
      pattern: PATTERN,
      bpm: 120,
      fillNotes: [],
    });
    const msPerBeat = 60000 / 120; // 500ms

    const kicks = allNotes(bundle).filter(n => n.type === noteTypes.kick);
    // Kick on beats 0 & 2 of each of the 2 groove bars.
    expect(kicks.map(n => n.tick).sort((a, b) => a - b)).toEqual([
      0 * RES,
      2 * RES,
      4 * RES,
      6 * RES,
    ]);
    for (const kick of kicks) {
      expect(kick.msTime).toBeCloseTo((kick.tick / RES) * msPerBeat);
    }

    // Hats are yellow cymbals on every beat of the groove bars.
    const hats = allNotes(bundle).filter(
      n =>
        n.type === noteTypes.yellowDrum && (n.flags & noteFlags.cymbal) !== 0,
    );
    expect(hats).toHaveLength(8);
  });

  it('places fill notes after the groove bars, preserving their rhythm', () => {
    const bundle = buildPracticeChart({
      pattern: PATTERN,
      bpm: 120,
      fillNotes: FILL_NOTES,
    });
    const fillStartTick = 2 * 4 * RES; // 2 groove bars

    expect(bundle.expectedNotes.map(n => n.tick)).toEqual([
      fillStartTick,
      fillStartTick + RES / 2,
      fillStartTick + RES,
      fillStartTick + 2 * RES,
      fillStartTick + 3.5 * RES,
    ]);
    // The crash keeps its cymbal flag; the toms get the tom flag.
    const crash = allNotes(bundle).find(
      n => n.tick === fillStartTick + 3.5 * RES,
    )!;
    expect(crash.type).toBe(noteTypes.greenDrum);
    expect(crash.flags & noteFlags.cymbal).not.toBe(0);
    const tom = allNotes(bundle).find(n => n.tick === fillStartTick + 2 * RES)!;
    expect(tom.flags & noteFlags.tom).not.toBe(0);
  });

  it('computes the fill window and loop end from the bar layout', () => {
    const bundle = buildPracticeChart({
      pattern: PATTERN,
      bpm: 120,
      fillNotes: FILL_NOTES,
    });
    // 120bpm → 500ms/beat; groove = 8 beats, loop = 12 beats.
    expect(bundle.grooveEndMs).toBeCloseTo(4000);
    expect(bundle.fillEndMs).toBeCloseTo(6000);
    // First fill note is on the fill downbeat.
    expect(bundle.fillStartMs).toBeCloseTo(4000);
  });

  it('scales every ms time with the bpm (tempo mismatch with the source chart)', () => {
    const fast = buildPracticeChart({
      pattern: PATTERN,
      bpm: 120,
      fillNotes: FILL_NOTES,
    });
    const slow = buildPracticeChart({
      pattern: PATTERN,
      bpm: 60,
      fillNotes: FILL_NOTES,
    });
    // Same ticks, doubled times at half tempo.
    expect(slow.expectedNotes.map(n => n.tick)).toEqual(
      fast.expectedNotes.map(n => n.tick),
    );
    slow.expectedNotes.forEach((n, i) => {
      expect(n.msTime).toBeCloseTo(fast.expectedNotes[i].msTime * 2);
    });
    expect(slow.fillEndMs).toBeCloseTo(fast.fillEndMs * 2);
  });

  it('only scores the fill notes (groove notes are backing, not expectations)', () => {
    const bundle = buildPracticeChart({
      pattern: PATTERN,
      bpm: 120,
      fillNotes: FILL_NOTES,
    });
    expect(bundle.expectedNotes).toHaveLength(FILL_NOTES.length);
    const fillStartTick = 2 * 4 * RES;
    expect(bundle.expectedNotes.every(n => n.tick >= fillStartTick)).toBe(true);
    // Sorted by time.
    for (let i = 1; i < bundle.expectedNotes.length; i++) {
      expect(bundle.expectedNotes[i].msTime).toBeGreaterThanOrEqual(
        bundle.expectedNotes[i - 1].msTime,
      );
    }
  });

  it('falls back to the groove end when the fill has no notes', () => {
    const bundle = buildPracticeChart({
      pattern: PATTERN,
      bpm: 120,
      fillNotes: [],
    });
    expect(bundle.fillStartMs).toBeCloseTo(bundle.grooveEndMs);
    expect(bundle.expectedNotes).toEqual([]);
  });

  it('labels the groove and fill sections', () => {
    const bundle = buildPracticeChart({
      pattern: PATTERN,
      bpm: 120,
      fillNotes: FILL_NOTES,
    });
    expect(bundle.chart.sections.map(s => s.name)).toEqual(['Groove', 'Fill']);
    expect(bundle.chart.sections[1].tick).toBe(2 * 4 * RES);
  });

  it('handles multi-bar grooves and multi-bar fills', () => {
    const pattern: BackingPattern = {
      ...PATTERN,
      grooveBars: 3,
      fillBars: 2,
    };
    const bundle = buildPracticeChart({
      pattern,
      bpm: 100,
      fillNotes: [{beatOffset: 6, lane: 'red', isCymbal: false}],
    });
    const msPerBeat = 600;
    expect(bundle.grooveEndMs).toBeCloseTo(3 * 4 * msPerBeat);
    expect(bundle.fillEndMs).toBeCloseTo(5 * 4 * msPerBeat);
    // Groove repeated in all three bars: 4 kicks/bar would be 2 — count kicks.
    const kicks = allNotes(bundle).filter(n => n.type === noteTypes.kick);
    expect(kicks).toHaveLength(3 * 2);
    // Fill note deep in the second fill bar.
    expect(bundle.expectedNotes[0].msTime).toBeCloseTo((12 + 6) * msPerBeat);
  });
});

describe('fillNotesToBeatOffsets', () => {
  it('converts source ticks to beats using the source resolution', () => {
    const notes = [
      {tick: 960, lane: 'red' as const, isCymbal: false},
      {tick: 1200, lane: 'green' as const, isCymbal: true},
    ];
    expect(fillNotesToBeatOffsets(notes, 960, 480)).toEqual([
      {beatOffset: 0, lane: 'red', isCymbal: false},
      {beatOffset: 0.5, lane: 'green', isCymbal: true},
    ]);
  });
});
