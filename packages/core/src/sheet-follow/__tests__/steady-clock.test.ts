import {steadyClock} from '../steady-clock';

/** Drives a steady clock at 60 frames a second from a scripted source. */
function run(sourceAt: (t: number) => number | null, seconds: number) {
  let t = 0;
  const tick = steadyClock(
    () => sourceAt(t),
    () => t * 1000,
  );
  const out: {t: number; shown: number | null}[] = [];
  for (let frame = 0; frame <= seconds * 60; frame++) {
    t = frame / 60;
    out.push({t, shown: tick()});
  }
  return out;
}

describe('steadyClock', () => {
  it('never runs backward when the estimate is corrected back', () => {
    // A song clock that runs 0.4s ahead and is pulled back every half second:
    // the sawtooth the follower's corrections make.
    const frames = run(t => t + 0.4 * ((t % 0.5) / 0.5), 10);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].shown!).toBeGreaterThanOrEqual(frames[i - 1].shown!);
    }
    expect(frames.at(-1)!.shown!).toBeCloseTo(10.2, 0);
  });

  it('keeps up with a band playing faster than the record', () => {
    const frames = run(t => t * 1.2, 20);
    expect(frames.at(-1)!.shown!).toBeCloseTo(24, 0);
  });

  it('takes a large jump at once, in either direction', () => {
    const back = run(t => (t < 5 ? 60 + t : 10 + t), 6);
    expect(back.find(f => f.t > 5.02)!.shown!).toBeCloseTo(15, 0);
    const ahead = run(t => (t < 5 ? t : 40 + t), 6);
    expect(ahead.find(f => f.t > 5.02)!.shown!).toBeCloseTo(45, 0);
  });

  it('is null while the source is, and restarts from the source', () => {
    const frames = run(t => (t > 2 && t < 3 ? null : 100 + t), 4);
    expect(frames.find(f => f.t > 2.5)!.shown).toBeNull();
    expect(frames.find(f => f.t > 3.02)!.shown!).toBeCloseTo(103, 0);
  });
});
