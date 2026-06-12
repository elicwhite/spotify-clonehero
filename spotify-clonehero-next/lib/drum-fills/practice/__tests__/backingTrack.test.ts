import {
  scheduleLoopEvents,
  loopDurationSeconds,
  BackingPattern,
  ScheduledEvent,
} from '../backingTrack';

// A simple 4/4 backbeat: kick on 1 & 3, snare on 2 & 4, hat on every beat.
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
  click: false,
};

describe('loopDurationSeconds', () => {
  it('covers groove + fill bars', () => {
    // 3 bars * 4 beats * 0.5s/beat (120bpm) = 6s
    expect(loopDurationSeconds(PATTERN, 120)).toBeCloseTo(6);
  });
});

describe('scheduleLoopEvents', () => {
  it('emits groove events within the window and none in the fill bar', () => {
    const events = scheduleLoopEvents(PATTERN, {
      bpm: 120,
      startTime: 0,
      windowSeconds: 6,
      loopAnchorTime: 0,
    });
    // 2 groove bars, each: 2 kick + 2 snare + 4 hat = 8 -> 16 events. Fill bar empty.
    expect(events.length).toBe(16);
    // Latest event is the last hat of bar 2 at beat (4 + 3) = 7 * 0.5 = 3.5s.
    const maxTime = Math.max(...events.map(e => e.time));
    expect(maxTime).toBeCloseTo(3.5);
    // No events at/after the fill bar start (bar 3 = beat 8 = 4.0s).
    expect(events.every(e => e.time < 4.0)).toBe(true);
  });

  it('adds a click on every groove beat when enabled', () => {
    const events = scheduleLoopEvents(
      {...PATTERN, click: true},
      {bpm: 120, startTime: 0, windowSeconds: 6, loopAnchorTime: 0},
    );
    const clicks = events.filter(e => e.voice === 'click');
    // 2 groove bars * 4 beats = 8 clicks.
    expect(clicks.length).toBe(8);
  });

  it('returns events sorted by time', () => {
    const events = scheduleLoopEvents(
      {...PATTERN, click: true},
      {bpm: 100, startTime: 0, windowSeconds: 12, loopAnchorTime: 0},
    );
    for (let i = 1; i < events.length; i++) {
      expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    }
  });

  it('only emits events within [startTime, startTime+window)', () => {
    const events = scheduleLoopEvents(PATTERN, {
      bpm: 120,
      startTime: 1.0,
      windowSeconds: 1.0,
      loopAnchorTime: 0,
    });
    expect(events.every(e => e.time >= 1.0 && e.time < 2.0)).toBe(true);
    // Beat 2 (kick) at 1.0, beat 3 hat... within [1,2): beats at 1.0 and 1.5.
    expect(events.length).toBeGreaterThan(0);
  });

  it('loops: second loop repeats the groove with the same phase', () => {
    const loopDur = loopDurationSeconds(PATTERN, 120); // 6s
    const first = scheduleLoopEvents(PATTERN, {
      bpm: 120,
      startTime: 0,
      windowSeconds: loopDur,
      loopAnchorTime: 0,
    });
    const second = scheduleLoopEvents(PATTERN, {
      bpm: 120,
      startTime: loopDur,
      windowSeconds: loopDur,
      loopAnchorTime: 0,
    });
    expect(second.length).toBe(first.length);
    // Each second-loop event is exactly one loop later than its counterpart.
    const norm = (e: ScheduledEvent) => ({
      voice: e.voice,
      time: Number((e.time - loopDur).toFixed(6)),
    });
    expect(second.map(norm)).toEqual(
      first.map(e => norm({...e, time: e.time + loopDur})),
    );
  });

  it('honours a loop anchor offset (phase) ', () => {
    const anchor = 2.0;
    const events = scheduleLoopEvents(PATTERN, {
      bpm: 120,
      startTime: anchor,
      windowSeconds: 0.6,
      loopAnchorTime: anchor,
    });
    // First groove hits (kick+hat) land exactly at the anchor.
    expect(events.some(e => Math.abs(e.time - anchor) < 1e-9)).toBe(true);
  });

  it('catches earlier-in-loop events when the window starts mid-loop', () => {
    // Window starting at 1.4s, anchor 0: should still find the beat-3 hits at 1.5.
    const events = scheduleLoopEvents(PATTERN, {
      bpm: 120,
      startTime: 1.4,
      windowSeconds: 0.2,
      loopAnchorTime: 0,
    });
    expect(events.some(e => Math.abs(e.time - 1.5) < 1e-9)).toBe(true);
  });

  it('returns empty for non-positive loop duration', () => {
    expect(
      scheduleLoopEvents(
        {...PATTERN, grooveBars: 0, fillBars: 0},
        {bpm: 120, startTime: 0, windowSeconds: 5, loopAnchorTime: 0},
      ),
    ).toEqual([]);
  });
});
