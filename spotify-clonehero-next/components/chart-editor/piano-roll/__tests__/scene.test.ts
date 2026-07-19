import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import {
  deriveBeatGrid,
  type TimeSignatureInput,
} from '@/lib/chart-edit/bar-derivation';
import {barBeatAtTick, buildBeatGrid} from '../scene';

const RES = 480;
const timedTempos = buildTimedTempos([{tick: 0, beatsPerMinute: 120}], RES);

describe('buildBeatGrid', () => {
  test('bar lines come from the shared deriveBeatGrid (one derivation)', () => {
    const ts: TimeSignatureInput[] = [];
    const endTick = RES * 4 * 3; // 3 bars of 4/4
    const beats = buildBeatGrid(ts, RES, endTick, timedTempos);
    const shared = deriveBeatGrid(ts, RES, endTick);
    // The piano-roll grid must be the SAME tick/downbeat list the highway
    // GridOverlay consumes — not an approximate re-derivation.
    expect(beats.map(b => b.tick)).toEqual(shared.map(b => b.tick));
    expect(beats.map(b => b.isDownbeat)).toEqual(shared.map(b => b.isDownbeat));
  });

  test('assigns ms from the tempo map and 1-based bar numbers', () => {
    const beats = buildBeatGrid([], RES, RES * 4 * 2, timedTempos);
    // 120 BPM, res 480 => 500 ms per beat.
    expect(beats[0]).toMatchObject({tick: 0, isDownbeat: true, barNumber: 1});
    expect(beats[0].ms).toBeCloseTo(0, 6);
    expect(beats[1].ms).toBeCloseTo(500, 6);
    expect(beats[4]).toMatchObject({
      tick: RES * 4,
      isDownbeat: true,
      barNumber: 2,
    });
    // Non-downbeat beats belong to the current bar.
    expect(beats[1].barNumber).toBe(1);
    expect(beats[5].barNumber).toBe(2);
  });

  test('respects denominator-scaled beats for 6/8', () => {
    const ts: TimeSignatureInput[] = [{tick: 0, numerator: 6, denominator: 8}];
    const endTick = RES * 4; // 2 bars of 6/8 (beat unit = res/2 = 240)
    const beats = buildBeatGrid(ts, RES, endTick, timedTempos);
    const shared = deriveBeatGrid(ts, RES, endTick);
    expect(beats.map(b => b.tick)).toEqual(shared.map(b => b.tick));
    // Downbeats fall every 6 eighth-note beats (every 6*240 = 1440 ticks).
    const downbeats = beats.filter(b => b.isDownbeat).map(b => b.tick);
    expect(downbeats).toEqual([0, 1440]);
  });
});

describe('barBeatAtTick', () => {
  const beats = buildBeatGrid([], RES, RES * 4 * 3, timedTempos);

  test('reports bar.beat within a bar', () => {
    expect(barBeatAtTick(0, beats)).toEqual({bar: 1, beat: 1});
    expect(barBeatAtTick(RES, beats)).toEqual({bar: 1, beat: 2});
    expect(barBeatAtTick(RES * 4, beats)).toEqual({bar: 2, beat: 1});
    expect(barBeatAtTick(RES * 5, beats)).toEqual({bar: 2, beat: 2});
  });

  test('a tick just past a beat still reports that beat', () => {
    expect(barBeatAtTick(RES + 10, beats)).toEqual({bar: 1, beat: 2});
  });

  test('empty grid is safe', () => {
    expect(barBeatAtTick(1000, [])).toEqual({bar: 1, beat: 1});
  });
});

// Sanity: ms mapping stays monotonic under a mid-song tempo change.
describe('buildBeatGrid with a tempo change', () => {
  test('ms increases monotonically across a tempo jump', () => {
    const tempos = buildTimedTempos(
      [
        {tick: 0, beatsPerMinute: 120},
        {tick: RES * 4, beatsPerMinute: 60},
      ],
      RES,
    );
    const beats = buildBeatGrid([], RES, RES * 4 * 2, tempos);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].ms).toBeGreaterThan(beats[i - 1].ms);
    }
    // First bar at 120 BPM: 4 beats * 500ms = 2000ms to the second downbeat.
    expect(tickToMs(RES * 4, tempos, RES)).toBeCloseTo(2000, 6);
  });
});
