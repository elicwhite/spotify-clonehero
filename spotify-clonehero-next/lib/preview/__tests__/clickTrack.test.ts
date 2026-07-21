import {buildBeatClickEvents} from '../clickTrack';

describe('buildBeatClickEvents', () => {
  const resolution = 480;

  it('emits one accented click per measure and unaccented clicks on the other beats, at 4/4 and 120bpm', () => {
    const tempos = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
    const timeSignatures = [{tick: 0, numerator: 4, denominator: 4}];

    // 120bpm quarter note = 500ms. Two measures = 8 beats = 4000ms.
    const events = buildBeatClickEvents({
      tempos,
      timeSignatures,
      resolution,
      durationMs: 4000,
    });

    expect(events).toHaveLength(8);
    expect(events.map(e => Math.round(e.timeMs))).toEqual([
      0, 500, 1000, 1500, 2000, 2500, 3000, 3500,
    ]);
    expect(events.map(e => e.accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it('shifts every event by chartDelayMs', () => {
    const tempos = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
    const timeSignatures = [{tick: 0, numerator: 4, denominator: 4}];

    const events = buildBeatClickEvents({
      tempos,
      timeSignatures,
      resolution,
      durationMs: 2000,
      chartDelayMs: 300,
    });

    expect(events.map(e => Math.round(e.timeMs))).toEqual([
      300, 800, 1300, 1800,
    ]);
  });

  it('accounts for tempo changes mid-track', () => {
    // First measure at 120bpm (quarter = 500ms), tempo doubles to 240bpm
    // (quarter = 250ms) starting at tick 1920 (beat 4, i.e. the 2nd measure).
    const tempos = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 1920, beatsPerMinute: 240, msTime: 2000},
    ];
    const timeSignatures = [{tick: 0, numerator: 4, denominator: 4}];

    const events = buildBeatClickEvents({
      tempos,
      timeSignatures,
      resolution,
      durationMs: 3000,
    });

    // Measure 1 beats at 0, 500, 1000, 1500 (120bpm); measure 2 beats at
    // 2000, 2250, 2500, 2750 (240bpm); the next beat lands exactly at the
    // duration cutoff and is included.
    expect(events.map(e => Math.round(e.timeMs))).toEqual([
      0, 500, 1000, 1500, 2000, 2250, 2500, 2750, 3000,
    ]);
  });

  it('respects a time signature change, switching beat spacing and re-accenting downbeats', () => {
    // 4/4 for the first measure (4 beats), then 3/4 starting at tick 1920.
    const tempos = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
    const timeSignatures = [
      {tick: 0, numerator: 4, denominator: 4},
      {tick: 1920, numerator: 3, denominator: 4},
    ];

    const events = buildBeatClickEvents({
      tempos,
      timeSignatures,
      resolution,
      durationMs: 3500,
    });

    // 4/4 measure: beats at 0, 500, 1000, 1500 (last accented=false since
    // beatIndex resets to 0 for the new time-signature segment).
    // 3/4 measure starting at 2000ms: beats at 2000 (accent), 2500, 3000.
    expect(events.map(e => Math.round(e.timeMs))).toEqual([
      0, 500, 1000, 1500, 2000, 2500, 3000,
    ]);
    expect(events.map(e => e.accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('a shorter beat denominator (e.g. 6/8) produces more, closer-spaced beats', () => {
    const tempos = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
    const timeSignatures = [{tick: 0, numerator: 6, denominator: 8}];

    // Eighth note at 120bpm = 250ms. 6/8 measure = 1500ms, 6 beats.
    const events = buildBeatClickEvents({
      tempos,
      timeSignatures,
      resolution,
      durationMs: 1500,
    });

    expect(events).toHaveLength(7);
    expect(events.map(e => Math.round(e.timeMs))).toEqual([
      0, 250, 500, 750, 1000, 1250, 1500,
    ]);
    expect(events[0].accent).toBe(true);
    expect(events[6].accent).toBe(true);
    expect(events.slice(1, 6).every(e => !e.accent)).toBe(true);
  });

  it('returns an empty array when there are no tempos or duration is non-positive', () => {
    expect(
      buildBeatClickEvents({
        tempos: [],
        timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
        resolution,
        durationMs: 1000,
      }),
    ).toEqual([]);

    expect(
      buildBeatClickEvents({
        tempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
        timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
        resolution,
        durationMs: 0,
      }),
    ).toEqual([]);
  });

  it('defaults to 4/4 when no time signatures are provided', () => {
    const tempos = [{tick: 0, beatsPerMinute: 120, msTime: 0}];

    const events = buildBeatClickEvents({
      tempos,
      timeSignatures: [],
      resolution,
      durationMs: 2000,
    });

    expect(events.map(e => Math.round(e.timeMs))).toEqual([0, 500, 1000, 1500]);
  });
});
