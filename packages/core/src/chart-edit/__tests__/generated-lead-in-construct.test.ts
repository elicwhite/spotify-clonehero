/**
 * The shape a generated tempo map actually arrives in, and the two steps that
 * turn it into a padded chart (plan 0124).
 *
 * Taken from a real run — "In Waves", loaded as audio and given nothing but
 * Generate tempo map. Resolution 480, and the map opens:
 *
 *     tick    0   3/4   156.752      <- the writer's lead-in construct
 *     tick 1440   4/4   154.376      <- where the music starts, 1148.31 ms in
 *     tick 9120         149.189
 *
 * Tick 0 is not music. `buildSyncLayout` must satisfy `ms(tick 0) = 0` with
 * the grid origin at the first downbeat, so it writes the gap as one partial
 * bar — three quarters at 156.752 IS 1148.31 ms. The 3/4 is arithmetic, not a
 * meter the song ever plays.
 *
 * Nothing infers that. Two earlier designs tried to spot the construct from
 * the chart's shape and both rewrote real charts, and the corpus says the
 * same shape occurs in charts humans wrote. The user says where the music
 * starts; everything else follows.
 */

import type {ChartDocument} from '../types';
import {
  addTempo,
  addTimeSignature,
  createEmptyChart,
  retimeChart,
} from '../index';
import {emptyTrackData} from './test-utils';
import {
  applyLeadIn,
  getAudioAnchor,
  getSongStartTick,
  leadInBars,
  openingBar,
  planLeadIn,
  recordSongStart,
  resolveOpening,
  setSongStartTick,
  songStartAudioMs,
} from '../leading-silence';

const RES = 480;
const SONG_START_TICK = 1440;

function generated(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: 156.752,
    resolution: RES,
  });
  parsedChart.timeSignatures[0] = {
    ...parsedChart.timeSignatures[0],
    numerator: 3,
    denominator: 4,
  };
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);

  addTimeSignature(doc, SONG_START_TICK, 4, 4);
  addTempo(doc, SONG_START_TICK, 154.376);
  addTempo(doc, 9120, 149.189);
  retimeChart(parsedChart);
  return doc;
}

it('opens on a construct: three quarters at 156.752 is the 1148 ms gap', () => {
  const chart = generated().parsedChart;
  expect(chart.tempos[1].tick).toBe(SONG_START_TICK);
  expect(chart.tempos[1].msTime).toBeCloseTo(1148.3, 1);
  expect(chart.timeSignatures[0]).toMatchObject({numerator: 3, denominator: 4});
});

it('reads tick 0 while nothing has said where the music is', () => {
  // The honest answer with no song start, and the reason the card states
  // these values before the user presses anything: a lead-in built here
  // would be whole bars of 3/4 at 156.8, a meter the song never plays.
  expect(resolveOpening(generated())).toMatchObject({
    meter: {numerator: 3, denominator: 4},
  });
});

describe('a song start that just misses the marker it meant', () => {
  // The flag is draggable and the pointer is not exact, so the recorded tick
  // lands a few ticks off the 4/4 / 154.376 marker the user aimed at.
  const NEAR = [SONG_START_TICK - 3, SONG_START_TICK - 1, SONG_START_TICK + 2];

  it.each(NEAR)('snaps a miss at tick %i onto the marker', tick => {
    expect(getSongStartTick(recordSongStart(generated(), tick))).toBe(
      SONG_START_TICK,
    );
  });

  it('leaves no sliver, and takes the opening from the right side', () => {
    // Unsnapped, a song start 3 ticks EARLY reads the construct's 3/4 at
    // 156.752 as the opening, and leaves the real marker alive ~2 ms after
    // the emitted tick 0 — a segment far too short to be music, which the
    // writer then has to cover at an absurd BPM.
    const doc = recordSongStart(generated(), SONG_START_TICK - 3);
    const after = applyLeadIn(doc, planLeadIn(doc)!).parsedChart;

    expect(after.tempos[0].beatsPerMinute).toBeCloseTo(154.376, 3);
    expect(after.timeSignatures).toHaveLength(1);
    // No second event crowded up against tick 0.
    const second = after.tempos[1];
    if (second) expect(second.msTime).toBeGreaterThan(100);
    expect(
      after.tempos.some(t => Math.abs(t.beatsPerMinute - 156.752) < 0.05),
    ).toBe(false);
  });

  it('does not reach for a marker that is genuinely further away', () => {
    // A quarter note off is a placement, not a miss. `resolution / 8` is a
    // 32nd; this is eight times that.
    const tick = SONG_START_TICK - RES;
    expect(getSongStartTick(recordSongStart(generated(), tick))).toBe(tick);
  });
});

describe('after the user says where the song starts', () => {
  const marked = () => setSongStartTick(generated(), SONG_START_TICK);

  it('measures the lead-in in the SONG’s bars, not tick 0’s', () => {
    // 1440 ticks of lead-in. Under tick 0's 3/4 that is exactly one bar;
    // under the song's own 4/4 it is 0.75. The buttons add and remove bars
    // of the SONG's meter, so the count the card reports has to be in that
    // unit or +1 and -1 do not correspond to it.
    //
    // Reading tick 0 here made the card say "Lead-in: 1 bar", call it whole,
    // and hide the re-fit — on the one chart shape the re-fit exists for.
    expect(leadInBars(marked())).toBeCloseTo(0.75, 9);
    expect(openingBar(marked()).barTicks).toBe(4 * RES);
  });

  it('takes the opening from there: 4/4 at 154.376', () => {
    expect(resolveOpening(marked())).toEqual({
      bpm: 154.376,
      meter: {numerator: 4, denominator: 4},
    });
    expect(songStartAudioMs(marked())).toBeCloseTo(1148.3, 1);
  });

  it('pads to two whole bars of the SONG’s meter and tempo', () => {
    const plan = planLeadIn(marked())!;
    const barMs = (4 * 60000) / 154.376;
    expect(plan.bars).toBe(2);
    expect(plan.newSync.timeSignatures[0]).toMatchObject({
      numerator: 4,
      denominator: 4,
    });
    expect(plan.newSync.tempos[0].bpm).toBeCloseTo(154.376, 3);
    // P = N * barMs - X, and the whole lead-in clears the two-second floor.
    expect(plan.padMs).toBeCloseTo(2 * barMs - 1148.31, 0);
    expect(2 * barMs).toBeGreaterThan(2000);
  });

  it('leaves tick 0 holding the song’s own opening, and no 3/4 anywhere', () => {
    const doc = marked();
    const after = applyLeadIn(doc, planLeadIn(doc)!).parsedChart;
    expect(after.tempos[0]).toMatchObject({tick: 0});
    expect(after.tempos[0].beatsPerMinute).toBeCloseTo(154.376, 3);
    expect(after.timeSignatures).toHaveLength(1);
    expect(after.timeSignatures[0]).toMatchObject({
      tick: 0,
      numerator: 4,
      denominator: 4,
    });
    expect(
      after.tempos.some(t => Math.abs(t.beatsPerMinute - 156.752) < 0.05),
    ).toBe(false);
  });

  it('puts the music on a bar line, two bars in', () => {
    const doc = marked();
    const after = applyLeadIn(doc, planLeadIn(doc)!);
    expect(getSongStartTick(after)).toBe(2 * 4 * RES);
    expect(leadInBars(after)).toBeCloseTo(2, 6);
  });

  it('keeps every later tempo on its own position in the recording', () => {
    const doc = marked();
    const before = doc.parsedChart.tempos.find(t => t.tick === 9120)!.msTime;
    const after = applyLeadIn(doc, planLeadIn(doc)!);
    const pad = getAudioAnchor(after)!.ms;
    const moved = after.parsedChart.tempos.find(
      t => Math.abs(t.beatsPerMinute - 149.189) < 0.05,
    )!;
    expect(moved.msTime - pad).toBeCloseTo(before, 0);
  });
});
