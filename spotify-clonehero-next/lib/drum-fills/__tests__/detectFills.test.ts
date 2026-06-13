import {detectFills, getExpertDrumsTrack} from '../detection/detectFills';
import {
  buildChart,
  backbeatBar,
  tomFillBar,
  RES,
  type PlannedNote,
} from './builder';

const BAR = RES * 4; // 4/4 bar in ticks

/** N bars of groove, then a tom fill at bar `fillBar`, then more groove. */
function songWithFill(
  grooveBars: number,
  fillBar: number,
  trailBars: number,
  builderFill = tomFillBar,
): PlannedNote[] {
  const notes: PlannedNote[] = [];
  for (let b = 0; b < grooveBars; b++) {
    notes.push(...backbeatBar(b * BAR));
  }
  notes.push(...builderFill(fillBar * BAR));
  for (let b = 0; b < trailBars; b++) {
    notes.push(...backbeatBar((fillBar + 1 + b) * BAR));
  }
  // Crash on landing downbeat.
  notes.push({tick: (fillBar + 1) * BAR, voices: ['crashGreen', 'kick']});
  return notes;
}

describe('detectFills', () => {
  it('detects a single planted tom fill after an established groove', () => {
    const notes = songWithFill(4, 4, 2);
    const chart = buildChart({notes});
    const fills = detectFills(chart);

    expect(fills.length).toBe(1);
    const fill = fills[0];
    expect(fill.startTick).toBe(4 * BAR);
    expect(fill.endTick).toBe(5 * BAR);
    expect(fill.features.tomFraction).toBeGreaterThan(0.3);
    expect(fill.features.densityRatio).toBeGreaterThan(1.3);
    expect(fill.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('returns no fills for a pure repeating groove', () => {
    const notes: PlannedNote[] = [];
    for (let b = 0; b < 8; b++) notes.push(...backbeatBar(b * BAR));
    const chart = buildChart({notes});
    expect(detectFills(chart)).toHaveLength(0);
  });

  it('returns [] when there is no drums track', () => {
    const chart = buildChart({notes: [], hasDrums: false});
    expect(getExpertDrumsTrack(chart)).toBeNull();
    expect(detectFills(chart)).toHaveLength(0);
  });

  it('returns [] for an empty drums track', () => {
    const chart = buildChart({notes: []});
    expect(detectFills(chart)).toHaveLength(0);
  });

  it('detects a fill across a tempo change mid-fill', () => {
    // Groove at 120, fill bar starts a 90 BPM section in the middle.
    const notes = songWithFill(4, 4, 2);
    const chart = buildChart({
      notes,
      tempos: [
        {tick: 0, beatsPerMinute: 120},
        {tick: 4 * BAR + RES * 2, beatsPerMinute: 90},
      ],
    });
    const fills = detectFills(chart);
    expect(fills.length).toBe(1);
    // Tempo at fill start should still be 120.
    expect(fills[0].tempoBpm).toBe(120);
  });

  it('detects a fill in an odd (7/8) time signature', () => {
    // Build groove + fill in 7/8: bar = 7 eighth notes = 7 * (RES/2) ticks.
    const eighth = RES / 2;
    const barTicks = 7 * eighth;
    const grooveBar = (start: number): PlannedNote[] => {
      const out: PlannedNote[] = [];
      for (let i = 0; i < 7; i++) {
        const voices: ('kick' | 'snare' | 'hatYellow')[] = ['hatYellow'];
        if (i === 0 || i === 4) voices.push('kick');
        if (i === 2) voices.push('snare');
        out.push({tick: start + i * eighth, voices});
      }
      return out;
    };
    const fillBar = (start: number): PlannedNote[] => {
      const sixteenth = RES / 4;
      const out: PlannedNote[] = [];
      const toms = ['snare', 'tomYellow', 'tomBlue', 'tomGreen'] as const;
      for (let i = 0; i < 14; i++) {
        out.push({tick: start + i * sixteenth, voices: [toms[i % 4]]});
      }
      return out;
    };
    const notes: PlannedNote[] = [];
    for (let b = 0; b < 5; b++) notes.push(...grooveBar(b * barTicks));
    notes.push(...fillBar(5 * barTicks));
    notes.push(...grooveBar(6 * barTicks));
    notes.push({tick: 6 * barTicks, voices: ['crashGreen']});

    const chart = buildChart({
      notes,
      timeSignatures: [{tick: 0, numerator: 7, denominator: 8}],
    });
    const fills = detectFills(chart);
    expect(fills.length).toBe(1);
    expect(fills[0].startTick).toBe(5 * barTicks);
  });

  it('does not crash on a half-bar pickup before the groove', () => {
    // A half bar of sparse notes, then groove, then a fill.
    const notes: PlannedNote[] = [];
    notes.push({tick: RES * 2, voices: ['snare']});
    notes.push({tick: RES * 3, voices: ['snare']});
    for (let b = 1; b < 5; b++) notes.push(...backbeatBar(b * BAR));
    notes.push(...tomFillBar(5 * BAR));
    notes.push(...backbeatBar(6 * BAR));
    notes.push({tick: 6 * BAR, voices: ['crashGreen']});

    const chart = buildChart({notes});
    const fills = detectFills(chart);
    expect(fills.length).toBeGreaterThanOrEqual(1);
    expect(fills.some(f => f.startTick === 5 * BAR)).toBe(true);
  });

  it('marks a fill that ends at a section boundary', () => {
    const notes = songWithFill(4, 4, 2);
    const chart = buildChart({
      notes,
      sections: [{tick: 5 * BAR, name: 'Chorus'}],
    });
    const fills = detectFills(chart);
    expect(fills.length).toBe(1);
    expect(fills[0].features.endsAtSection).toBe(true);
  });

  it('flags crash-end when the fill resolves to a crash downbeat', () => {
    const notes = songWithFill(4, 4, 2);
    const chart = buildChart({notes});
    const fills = detectFills(chart);
    expect(fills[0].features.endsOnCrash).toBe(true);
  });

  it('skips charts longer than maxSongMs (e.g. album charts)', () => {
    const notes = songWithFill(4, 4, 2);
    // Same chart detects normally...
    expect(detectFills(buildChart({notes}))).toHaveLength(1);
    // ...but is skipped entirely once it exceeds the duration cap. The chart
    // has no song_length metadata, so the fallback (last note time) applies.
    expect(detectFills(buildChart({notes}), {maxSongMs: 1})).toHaveLength(0);
  });

  it('uses declared song_length to skip over-long charts', () => {
    const notes = songWithFill(4, 4, 2);
    const chart = buildChart({notes});
    // A short chart with a 20-minute declared length is treated as over-long.
    (chart.metadata as {song_length?: number}).song_length = 20 * 60 * 1000;
    expect(detectFills(chart)).toHaveLength(0);
  });
});

describe('detectFills substance gate (plan 0045 §5)', () => {
  /** Groove for `n` bars, then `fillBar` content, then groove + landing crash. */
  function songWith(
    grooveBars: number,
    fillBarNotes: PlannedNote[],
    landingBar: number,
  ): PlannedNote[] {
    const notes: PlannedNote[] = [];
    for (let b = 0; b < grooveBars; b++) notes.push(...backbeatBar(b * BAR));
    notes.push(...fillBarNotes);
    for (let b = landingBar; b < landingBar + 2; b++) {
      notes.push(...backbeatBar(b * BAR));
    }
    return notes;
  }

  it('does NOT flag a lone crash on the downbeat as a fill', () => {
    // Groove, then a bar whose only departure is a single crash on beat 1.
    const fillBar: PlannedNote[] = [
      {tick: 5 * BAR, voices: ['crashGreen']},
      // sparse backbeat kept so the bar isn't empty, but no roll
    ];
    for (let i = 0; i < 8; i++) {
      const tick = 5 * BAR + i * (RES / 2);
      const voices: ('hatYellow' | 'kick' | 'snare')[] = ['hatYellow'];
      if (i === 0 || i === 4) voices.push('kick');
      if (i === 2 || i === 6) voices.push('snare');
      fillBar.push({tick, voices});
    }
    const notes = songWith(5, fillBar, 6);
    const fills = detectFills(buildChart({notes}));
    expect(fills).toHaveLength(0);
  });

  it('does NOT flag a crash+kick push as a fill', () => {
    const fillBar: PlannedNote[] = [
      {tick: 5 * BAR, voices: ['crashGreen', 'kick']},
    ];
    const notes = songWith(5, fillBar, 6);
    const fills = detectFills(buildChart({notes}));
    expect(fills).toHaveLength(0);
  });

  it('does NOT flag a single flam as a fill', () => {
    const fillBar: PlannedNote[] = [
      {tick: 5 * BAR, voices: ['snare'], extraFlags: 0},
    ];
    const notes = songWith(5, fillBar, 6);
    const fills = detectFills(buildChart({notes}));
    expect(fills).toHaveLength(0);
  });

  it('does NOT flag two grace notes clustered on the downbeat (sub-quarter span)', () => {
    // Three onsets but all within the first 16th of the bar: deviation span is
    // tiny, so the quarter-bar span requirement rejects it.
    const fillBar: PlannedNote[] = [
      {tick: 5 * BAR, voices: ['snare']},
      {tick: 5 * BAR + RES / 8, voices: ['tomYellow']},
      {tick: 5 * BAR + RES / 4, voices: ['crashGreen']},
    ];
    const notes = songWith(5, fillBar, 6);
    const fills = detectFills(buildChart({notes}));
    expect(fills).toHaveLength(0);
  });

  it('still detects a real 16th tom roll', () => {
    const notes = songWith(5, tomFillBar(5 * BAR), 6);
    notes.push({tick: 6 * BAR, voices: ['crashGreen']});
    const fills = detectFills(buildChart({notes}));
    expect(fills.length).toBe(1);
    expect(fills[0].startTick).toBe(5 * BAR);
  });
});
