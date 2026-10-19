import {
  buildFingerprints,
  computeBars,
  fingerprintSimilarity,
  inferLocalGroove,
  noteEventToVoice,
  ticksPerBar,
} from '../detection/grooveModel';
import {buildChart, backbeatBar, RES, type PlannedNote} from './builder';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';

describe('noteEventToVoice', () => {
  it('maps kick / snare', () => {
    expect(noteEventToVoice({type: noteTypes.kick, flags: 0})).toBe('kick');
    expect(noteEventToVoice({type: noteTypes.redDrum, flags: 0})).toBe('snare');
  });
  it('distinguishes yellow hat (cymbal) from yellow tom', () => {
    expect(
      noteEventToVoice({type: noteTypes.yellowDrum, flags: noteFlags.cymbal}),
    ).toBe('hat');
    expect(
      noteEventToVoice({type: noteTypes.yellowDrum, flags: noteFlags.tom}),
    ).toBe('tom');
  });
  it('maps green/blue cymbal to crash, tom-flagged to tom', () => {
    expect(
      noteEventToVoice({type: noteTypes.greenDrum, flags: noteFlags.cymbal}),
    ).toBe('crash');
    expect(
      noteEventToVoice({type: noteTypes.blueDrum, flags: noteFlags.tom}),
    ).toBe('tom');
  });
});

describe('ticksPerBar', () => {
  it('computes 4/4 and 7/8', () => {
    expect(ticksPerBar(192, 4, 4)).toBe(192 * 4);
    expect(ticksPerBar(192, 7, 8)).toBe(Math.round((192 * 4 * 7) / 8));
  });
});

describe('computeBars', () => {
  it('switches bar length at a time-signature change', () => {
    const chart = {
      resolution: RES,
      timeSignatures: [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: RES * 4 * 2, numerator: 3, denominator: 4},
      ],
    };
    const bars = computeBars(chart as never, RES * 4 * 4);
    expect(bars[0].numerator).toBe(4);
    // After two 4/4 bars, a 3/4 bar begins.
    expect(bars[2].numerator).toBe(3);
    expect(bars[2].endTick - bars[2].startTick).toBe(RES * 3);
  });
});

describe('fingerprints + similarity', () => {
  it('identical bars have similarity 1', () => {
    const notes: PlannedNote[] = [...backbeatBar(0), ...backbeatBar(RES * 4)];
    const chart = buildChart({notes});
    const track = chart.trackData[0];
    const fps = buildFingerprints(chart, track);
    expect(fps.length).toBeGreaterThanOrEqual(2);
    expect(fingerprintSimilarity(fps[0], fps[1])).toBe(1);
  });

  it('different bars have lower similarity', () => {
    const notes: PlannedNote[] = [
      ...backbeatBar(0),
      {tick: RES * 4, voices: ['tomGreen']},
      {tick: RES * 4 + RES, voices: ['tomBlue']},
    ];
    const chart = buildChart({notes});
    const fps = buildFingerprints(chart, chart.trackData[0]);
    expect(fingerprintSimilarity(fps[0], fps[1])).toBeLessThan(0.5);
  });
});

describe('inferLocalGroove', () => {
  it('returns the dominant groove fingerprint', () => {
    const notes: PlannedNote[] = [];
    for (let b = 0; b < 5; b++) notes.push(...backbeatBar(b * RES * 4));
    const chart = buildChart({notes});
    const fps = buildFingerprints(chart, chart.trackData[0]);
    const groove = inferLocalGroove(fps, 4, {
      window: 6,
      minCount: 2,
      similarity: 0.7,
    });
    expect(groove).not.toBeNull();
    expect(fingerprintSimilarity(groove!, fps[0])).toBe(1);
  });

  it('returns null with no established groove', () => {
    const fps = buildFingerprints(
      buildChart({notes: backbeatBar(0)}),
      buildChart({notes: backbeatBar(0)}).trackData[0],
    );
    expect(
      inferLocalGroove(fps, 0, {window: 6, minCount: 2, similarity: 0.7}),
    ).toBeNull();
  });
});
