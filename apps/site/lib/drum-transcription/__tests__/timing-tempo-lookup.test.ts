/**
 * The tempo lookup inside `tickToMs`/`msToTick` binary-searches an ascending
 * tempo map. These lock it to the scan it replaced: same segment, therefore
 * same millisecond, for every position — including the boundaries, where an
 * off-by-one would pick the neighbouring tempo and shift a note.
 */
import {buildTimedTempos, msToTick, tickToMs} from '../timing';
import type {TimedTempo} from '../chart-types';

const RESOLUTION = 192;

/** The linear scan `activeTempoIndex` replaced. */
function scanIndex(
  timedTempos: TimedTempo[],
  position: number,
  of: (t: TimedTempo) => number,
): number {
  let index = 0;
  for (let i = 1; i < timedTempos.length; i++) {
    if (of(timedTempos[i]) <= position) index = i;
    else break;
  }
  return index;
}

function referenceTickToMs(tick: number, timed: TimedTempo[]): number {
  const tempo = timed[scanIndex(timed, tick, t => t.tick)];
  return (
    tempo.msTime +
    ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * RESOLUTION)
  );
}

function referenceMsToTick(ms: number, timed: TimedTempo[]): number {
  const tempo = timed[scanIndex(timed, ms, t => t.msTime)];
  return Math.round(
    tempo.tick +
      ((ms - tempo.msTime) * tempo.beatsPerMinute * RESOLUTION) / 60000,
  );
}

describe('tempo lookup', () => {
  const tempos = [
    {tick: 0, beatsPerMinute: 120},
    {tick: 768, beatsPerMinute: 90},
    {tick: 1536, beatsPerMinute: 155.5},
    {tick: 4032, beatsPerMinute: 200},
    {tick: 9600, beatsPerMinute: 60},
  ];
  const timed = buildTimedTempos(tempos, RESOLUTION);

  it('picks the same segment as the linear scan at every tempo boundary', () => {
    for (const t of timed) {
      for (const tick of [t.tick - 1, t.tick, t.tick + 1]) {
        expect(tickToMs(tick, timed, RESOLUTION)).toBeCloseTo(
          referenceTickToMs(tick, timed),
          9,
        );
      }
    }
  });

  it('matches the linear scan across the whole chart', () => {
    for (let tick = -50; tick <= 12000; tick += 7) {
      expect(tickToMs(tick, timed, RESOLUTION)).toBeCloseTo(
        referenceTickToMs(tick, timed),
        9,
      );
    }
  });

  it('matches the linear scan for msToTick, boundaries included', () => {
    for (const t of timed) {
      for (const ms of [t.msTime - 0.001, t.msTime, t.msTime + 0.001]) {
        expect(msToTick(ms, timed, RESOLUTION)).toBe(
          referenceMsToTick(ms, timed),
        );
      }
    }
    for (let ms = -100; ms <= 20000; ms += 13) {
      expect(msToTick(ms, timed, RESOLUTION)).toBe(
        referenceMsToTick(ms, timed),
      );
    }
  });

  it('holds for a single-tempo chart', () => {
    const one = buildTimedTempos([{tick: 0, beatsPerMinute: 128}], RESOLUTION);
    for (const tick of [-10, 0, 1, 5000]) {
      expect(tickToMs(tick, one, RESOLUTION)).toBeCloseTo(
        referenceTickToMs(tick, one),
        9,
      );
    }
  });
  it('keeps the scan on an out-of-order tempo map', () => {
    // scan-chart's `.chart` parser keeps [SyncTrack] entries in file order, so
    // a chart can hand us a map that steps backwards. The map is nonsense
    // either way; what matters is that we return the same nonsense as before,
    // instead of moving notes on those charts.
    const outOfOrder = buildTimedTempos(
      [
        {tick: 0, beatsPerMinute: 120},
        {tick: 1000, beatsPerMinute: 60},
        {tick: 200, beatsPerMinute: 90},
        {tick: 300, beatsPerMinute: 90},
      ],
      RESOLUTION,
    );
    for (let tick = -10; tick <= 1500; tick += 5) {
      expect(tickToMs(tick, outOfOrder, RESOLUTION)).toBeCloseTo(
        referenceTickToMs(tick, outOfOrder),
        9,
      );
    }
    // The specific divergence a binary search would have introduced.
    expect(tickToMs(250, outOfOrder, RESOLUTION)).toBeCloseTo(
      referenceTickToMs(250, outOfOrder),
      9,
    );
  });

  it('keeps the scan on an out-of-order map for msToTick too', () => {
    const outOfOrder = buildTimedTempos(
      [
        {tick: 0, beatsPerMinute: 120},
        {tick: 1000, beatsPerMinute: 60},
        {tick: 200, beatsPerMinute: 90},
      ],
      RESOLUTION,
    );
    for (let ms = -50; ms <= 3000; ms += 7) {
      expect(msToTick(ms, outOfOrder, RESOLUTION)).toBe(
        referenceMsToTick(ms, outOfOrder),
      );
    }
  });
});
