import {
  clearTaps,
  emptyTapSession,
  fitTapTempo,
  pushTap,
  type TapSession,
} from '../tap-tempo';

/** Evenly spaced taps starting at `start`. */
function evenTaps(count: number, periodMs: number, start = 1000): number[] {
  return Array.from({length: count}, (_, i) => start + i * periodMs);
}

/** Feed a list of absolute times through the push-time guards. */
function sessionFrom(times: readonly number[]): TapSession {
  return times.reduce(
    (session, t) => pushTap(session, t),
    emptyTapSession(3840, 12345),
  );
}

/** Deterministic pseudo-random in [-1, 1), so the jitter cases never flake. */
function seededNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0x100000000) * 2 - 1;
  };
}

function bpmOf(taps: readonly number[], rate = 1): number {
  const fit = fitTapTempo(taps, rate);
  if (fit.status !== 'ok') throw new Error(`expected a fit, got ${fit.status}`);
  return fit.bpm;
}

describe('fitTapTempo', () => {
  it('fits perfectly even taps exactly', () => {
    const fit = fitTapTempo(evenTaps(8, 500), 1);
    expect(fit.status).toBe('ok');
    if (fit.status !== 'ok') return;
    expect(fit.bpm).toBeCloseTo(120, 9);
    expect(fit.periodMs).toBeCloseTo(500, 9);
    expect(fit.stdErrBpm).toBeCloseTo(0, 9);
    expect(fit.tapCount).toBe(8);
  });

  it('reports insufficient below three taps and fits from three', () => {
    for (const n of [0, 1, 2]) {
      const fit = fitTapTempo(evenTaps(n, 500), 1);
      expect(fit).toEqual({status: 'insufficient', tapCount: n});
    }
    const three = fitTapTempo(evenTaps(3, 500), 1);
    expect(three.status).toBe('ok');
    if (three.status === 'ok') expect(three.bpm).toBeCloseTo(120, 9);
  });

  it('beats the telescoping span/(n-1) estimator on a late final tap', () => {
    const taps = evenTaps(8, 500);
    taps[taps.length - 1] += 60;

    const regression = bpmOf(taps);
    const span = taps[taps.length - 1] - taps[0];
    const spanBpm = 60000 / (span / (taps.length - 1));

    expect(Math.abs(regression - 120)).toBeLessThan(Math.abs(spanBpm - 120));
  });

  it('lands within 1.5 BPM on jittered taps, and improves with more taps', () => {
    const periodMs = 60000 / 143.7;
    const noise = seededNoise(7);
    const taps = Array.from(
      {length: 16},
      (_, i) => 500 + i * periodMs + noise() * 25,
    );

    const many = Math.abs(bpmOf(taps) - 143.7);
    const few = Math.abs(bpmOf(taps.slice(0, 4)) - 143.7);
    expect(many).toBeLessThan(1.5);
    expect(many).toBeLessThanOrEqual(few);
  });

  it('survives a missed beat, because the beat index jumps by two', () => {
    const taps = evenTaps(9, 500).filter((_, i) => i !== 5);
    expect(bpmOf(taps)).toBeCloseTo(120, 6);
  });

  it('drops a single outlier at five taps or more, but not below', () => {
    const taps = evenTaps(8, 500);
    taps[4] -= 200;

    const fit = fitTapTempo(taps, 1);
    expect(fit.status).toBe('ok');
    if (fit.status !== 'ok') return;
    expect(Math.abs(fit.bpm - 120)).toBeLessThan(0.5);
    expect(fit.tapCount).toBe(7);

    const small = evenTaps(4, 500);
    small[2] -= 200;
    const smallFit = fitTapTempo(small, 1);
    expect(smallFit.status).toBe('ok');
    if (smallFit.status !== 'ok') return;
    expect(smallFit.tapCount).toBe(4);
  });

  it('drops at most one tap even with two bad ones', () => {
    const taps = evenTaps(10, 500);
    taps[3] -= 180;
    taps[7] += 180;

    const fit = fitTapTempo(taps, 1);
    expect(fit.status).toBe('ok');
    if (fit.status !== 'ok') return;
    expect(fit.tapCount).toBe(9);
    expect(Number.isFinite(fit.bpm)).toBe(true);
  });

  it('scales the wall-clock fit into song time by the playback rate', () => {
    const taps = evenTaps(8, 500);
    expect(bpmOf(taps, 0.75)).toBeCloseTo(bpmOf(taps, 1) / 0.75, 9);
    // 400 ms of wall time at 0.75x is 300 ms of song time: 200 BPM.
    expect(bpmOf(evenTaps(8, 400), 0.75)).toBeCloseTo(200, 9);
    // ...and 800 ms of song time at 2x: 75 BPM.
    expect(bpmOf(evenTaps(8, 400), 2)).toBeCloseTo(75, 9);
  });

  it('keeps every tap in the fit and converges as taps accumulate', () => {
    const noise = seededNoise(11);
    const taps = Array.from(
      {length: 60},
      (_, i) => 500 + i * 500 + noise() * 20,
    );

    const fit = fitTapTempo(taps, 1);
    expect(fit.status).toBe('ok');
    if (fit.status !== 'ok') return;
    expect(fit.tapCount).toBe(60);

    // Convergence, with no eviction step to make the number jump: the
    // reported uncertainty shrinks monotonically as taps accumulate, and the
    // estimate stays inside it.
    const errAt = (n: number) => {
      const partial = fitTapTempo(taps.slice(0, n), 1);
      if (partial.status !== 'ok') throw new Error('expected a fit');
      return partial;
    };
    expect(errAt(60).stdErrBpm).toBeLessThan(errAt(25).stdErrBpm);
    expect(errAt(25).stdErrBpm).toBeLessThan(errAt(10).stdErrBpm);
    expect(Math.abs(fit.bpm - 120)).toBeLessThan(0.5);
  });

  it('never returns NaN or Infinity for degenerate input', () => {
    expect(fitTapTempo([1000, 1000, 1000], 1)).toEqual({
      status: 'insufficient',
      tapCount: 3,
    });
    // Out-of-order times never reach the fit through `pushTap`, and on their
    // own they report insufficient rather than a negative period.
    expect(fitTapTempo([1000, 900, 800], 1)).toEqual({
      status: 'insufficient',
      tapCount: 3,
    });
    const zeroRate = fitTapTempo(evenTaps(4, 500), 0);
    expect(zeroRate.status).toBe('ok');
    if (zeroRate.status === 'ok') expect(zeroRate.bpm).toBeCloseTo(120, 9);
  });
});

describe('pushTap', () => {
  it('discards a double strike without recording it', () => {
    const clean = sessionFrom(evenTaps(4, 500));
    const doubled = pushTap(clean, clean.taps[clean.taps.length - 1] + 40);

    expect(doubled.taps).toEqual(clean.taps);
    expect(fitTapTempo(doubled.taps, 1)).toEqual(fitTapTempo(clean.taps, 1));
  });

  it('discards a tap at or before the previous one', () => {
    const session = sessionFrom([1000, 1500]);
    expect(pushTap(session, 1500).taps).toEqual([1000, 1500]);
    expect(pushTap(session, 1400).taps).toEqual([1000, 1500]);
  });

  it('restarts the session after a long pause', () => {
    const session = sessionFrom(evenTaps(4, 500));
    const restarted = pushTap(session, session.taps[3] + 3000);
    expect(restarted.taps).toHaveLength(1);
    expect(restarted.anchorTick).toBe(session.anchorTick);

    // The pause threshold also tracks slow tempos: four periods at 1000 ms
    // beats the 2500 ms floor.
    const slow = sessionFrom(evenTaps(4, 1000));
    const kept = pushTap(slow, slow.taps[3] + 3000);
    expect(kept.taps).toHaveLength(5);
  });

  it('records ordinary taps and caps the session length', () => {
    const session = sessionFrom(evenTaps(600, 500));
    expect(session.taps).toHaveLength(512);
    expect(session.taps[511]).toBe(1000 + 599 * 500);
  });
});

describe('session helpers', () => {
  it('clears the taps but keeps the anchor', () => {
    const session = sessionFrom(evenTaps(4, 500));
    const cleared = clearTaps(session);
    expect(cleared.taps).toEqual([]);
    expect(cleared.anchorTick).toBe(3840);
    expect(cleared.anchorMs).toBe(12345);
  });

  it('round-trips an empty session', () => {
    expect(emptyTapSession(1920, 500)).toEqual({
      anchorTick: 1920,
      anchorMs: 500,
      taps: [],
    });
    expect(clearTaps(emptyTapSession(1920, 500))).toEqual(
      emptyTapSession(1920, 500),
    );
  });
});
