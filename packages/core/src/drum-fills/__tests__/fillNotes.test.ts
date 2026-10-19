import {buildChart, backbeatBar, tomFillBar, RES} from './builder';
import {buildFillPracticeData, buildGroovePattern} from '../practice/fillNotes';

const BAR = RES * 4; // ticks per 4/4 bar

function expertTrack(chart: ReturnType<typeof buildChart>) {
  const t = chart.trackData.find(
    td => td.instrument === 'drums' && td.difficulty === 'expert',
  );
  if (!t) throw new Error('no track');
  return t;
}

describe('buildFillPracticeData', () => {
  // Groove bar 0, tom fill bar 1.
  const chart = buildChart({
    bpm: 120,
    notes: [...backbeatBar(0), ...tomFillBar(BAR)],
  });
  const track = expertTrack(chart);
  const fill = {
    startTick: BAR,
    endTick: BAR * 2,
    grooveStartTick: 0,
    grooveEndTick: BAR,
    tempoBpm: 120,
  };

  it('extracts every fill-span note with lane + cymbal classification', () => {
    const data = buildFillPracticeData(chart, track, fill);
    // 16 onsets in the tom fill bar, one voice each.
    expect(data.notes.length).toBe(16);
    // All notes fall inside the fill span.
    for (const n of data.notes) {
      expect(n.tick).toBeGreaterThanOrEqual(BAR);
      expect(n.tick).toBeLessThan(BAR * 2);
    }
    // First four are snare (red, not cymbal); last four green tom (not cymbal).
    expect(data.notes[0].lane).toBe('red');
    expect(data.notes[0].isCymbal).toBe(false);
    const greens = data.notes.filter(n => n.lane === 'green');
    expect(greens.length).toBe(4);
    expect(greens.every(n => n.isCymbal === false)).toBe(true);
  });

  it('sorts notes by ms time and assigns unique stable ids', () => {
    const data = buildFillPracticeData(chart, track, fill);
    for (let i = 1; i < data.notes.length; i++) {
      expect(data.notes[i].msTime).toBeGreaterThanOrEqual(
        data.notes[i - 1].msTime,
      );
    }
    const ids = new Set(data.notes.map(n => n.id));
    expect(ids.size).toBe(data.notes.length);
  });

  it('computes ms spans and bar layout', () => {
    const data = buildFillPracticeData(chart, track, fill);
    // 120 BPM, 4/4: one bar = 2000ms.
    expect(data.grooveStartMs).toBeCloseTo(0, 3);
    expect(data.grooveEndMs).toBeCloseTo(2000, 3);
    expect(data.fillEndMs).toBeCloseTo(4000, 3);
    expect(data.beatsPerBar).toBe(4);
    expect(data.grooveBars).toBe(1);
    expect(data.fillBars).toBe(1);
    expect(data.bpm).toBe(120);
  });

  it('marks cymbals only when the cymbal flag is set on yellow/blue/green', () => {
    // A bar with a yellow cymbal (hat) onset.
    const c = buildChart({
      notes: [
        ...backbeatBar(0),
        {tick: BAR, voices: ['hatYellow']},
        {tick: BAR + RES, voices: ['crashGreen']},
      ],
    });
    const t = expertTrack(c);
    const data = buildFillPracticeData(c, t, {
      startTick: BAR,
      endTick: BAR * 2,
      grooveStartTick: 0,
      grooveEndTick: BAR,
      tempoBpm: 120,
    });
    const yellow = data.notes.find(n => n.lane === 'yellow');
    expect(yellow?.isCymbal).toBe(true);
    const green = data.notes.find(n => n.lane === 'green');
    expect(green?.isCymbal).toBe(true);
  });

  it('handles an empty fill span (no notes) using the groove end as start', () => {
    const data = buildFillPracticeData(chart, track, {
      startTick: BAR * 5,
      endTick: BAR * 6,
      grooveStartTick: BAR * 4,
      grooveEndTick: BAR * 5,
      tempoBpm: 120,
    });
    expect(data.notes.length).toBe(0);
    expect(data.fillStartMs).toBeCloseTo(data.grooveEndMs, 3);
  });
});

describe('buildGroovePattern', () => {
  const chart = buildChart({
    bpm: 120,
    notes: [...backbeatBar(0), ...tomFillBar(BAR)],
  });
  const track = expertTrack(chart);
  const fill = {
    startTick: BAR,
    grooveStartTick: 0,
    grooveEndTick: BAR,
  };
  const layout = {grooveBars: 1, fillBars: 1, beatsPerBar: 4};

  it('produces a clickable backing pattern with kick/snare/hat voices', () => {
    const pattern = buildGroovePattern(chart, track, fill, layout);
    expect(pattern.click).toBe(true);
    expect(pattern.grooveBars).toBe(1);
    expect(pattern.fillBars).toBe(1);
    expect(pattern.beatsPerBar).toBe(4);

    const voices = new Set(pattern.groove.map(h => h.lane));
    expect(voices.has('kick')).toBe(true);
    expect(voices.has('snare')).toBe(true);
    expect(voices.has('hat')).toBe(true);
  });

  it('places kicks on beats 0 and 2, snares on beats 1 and 3', () => {
    const pattern = buildGroovePattern(chart, track, fill, layout);
    const kicks = pattern.groove
      .filter(h => h.lane === 'kick')
      .map(h => h.beatOffset)
      .sort((a, b) => a - b);
    const snares = pattern.groove
      .filter(h => h.lane === 'snare')
      .map(h => h.beatOffset)
      .sort((a, b) => a - b);
    expect(kicks).toEqual([0, 2]);
    expect(snares).toEqual([1, 3]);
  });

  it('dedupes onsets folded onto the same beat', () => {
    const pattern = buildGroovePattern(chart, track, fill, layout);
    const keys = pattern.groove.map(h => `${h.beatOffset}:${h.lane}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
