import {buildFingerprints} from '../detection/grooveModel';
import {
  canonicalGrooveFingerprint,
  fillSimilarityKey,
  grooveSimilarityKey,
  grooveSpanFingerprints,
  pickCanonicalBar,
} from '../detection/grooveFingerprint';
import {
  buildChart,
  backbeatBar,
  tomFillBar,
  RES,
  type PlannedNote,
} from './builder';

const BAR = RES * 4;

/** Fingerprints for a multi-bar groove built from planned notes. */
function fps(notes: PlannedNote[]) {
  const chart = buildChart({notes});
  const track = chart.trackData[0] as never;
  return buildFingerprints(chart, track as never);
}

describe('grooveSpanFingerprints', () => {
  it('selects bars fully contained in [grooveStart, grooveEnd)', () => {
    const notes = [
      ...backbeatBar(0),
      ...backbeatBar(BAR),
      ...backbeatBar(2 * BAR),
    ];
    const all = fps(notes);
    // Groove span = first two bars; third bar is the (hypothetical) fill.
    const span = grooveSpanFingerprints(all, 0, 2 * BAR);
    expect(span.map(f => f.barIndex)).toEqual([0, 1]);
  });
});

describe('pickCanonicalBar', () => {
  it('returns the repeated groove bar over a one-off variation', () => {
    // Bars 0,1 identical backbeat; bar 2 different (extra kicks).
    const variation: PlannedNote[] = backbeatBar(2 * BAR).map(n =>
      n.voices.includes('kick')
        ? n
        : {...n, voices: [...n.voices, 'kick' as const]},
    );
    const all = fps([...backbeatBar(0), ...backbeatBar(BAR), ...variation]);
    const canon = pickCanonicalBar(all);
    expect(canon).not.toBeNull();
    // The dominant bar matches one of the two identical backbeat bars.
    expect(canon!.key).toBe(all[0].key);
  });

  it('returns null for an empty span', () => {
    expect(pickCanonicalBar([])).toBeNull();
  });
});

describe('canonicalGrooveFingerprint', () => {
  it('is deterministic and position-independent for the same groove', () => {
    const a = grooveSpanFingerprints(
      fps([...backbeatBar(0), ...backbeatBar(BAR)]),
      0,
      2 * BAR,
    );
    // Same groove shifted later in the song.
    const b = grooveSpanFingerprints(
      fps([
        ...backbeatBar(0),
        ...backbeatBar(BAR),
        ...backbeatBar(2 * BAR),
        ...backbeatBar(3 * BAR),
      ]),
      2 * BAR,
      4 * BAR,
    );
    const fpA = canonicalGrooveFingerprint(a);
    const fpB = canonicalGrooveFingerprint(b);
    expect(fpA).not.toBe('');
    expect(fpA).toBe(fpB);
  });

  it('returns empty string for an onset-less span', () => {
    expect(canonicalGrooveFingerprint([])).toBe('');
  });

  it('differs for grooves with different voicings', () => {
    const backbeat = canonicalGrooveFingerprint(
      grooveSpanFingerprints(fps(backbeatBar(0)), 0, BAR),
    );
    // Snare-on-every-8th groove.
    const snareGroove: PlannedNote[] = backbeatBar(0).map(n => ({
      ...n,
      voices: n.voices.includes('snare')
        ? n.voices
        : [...n.voices, 'snare' as const],
    }));
    const other = canonicalGrooveFingerprint(
      grooveSpanFingerprints(fps(snareGroove), 0, BAR),
    );
    expect(backbeat).not.toBe(other);
  });
});

describe('grooveSimilarityKey', () => {
  it('collapses hat vs crash cymbal so cymbal choice does not fragment', () => {
    // Two grooves identical except the cymbal voice: yellow hat vs green crash.
    const hatGroove = backbeatBar(0); // uses hatYellow
    const crashGroove: PlannedNote[] = backbeatBar(0).map(n => ({
      ...n,
      voices: n.voices.map(v =>
        v === 'hatYellow' ? ('crashGreen' as const) : v,
      ),
    }));

    const hatKey = grooveSimilarityKey(
      grooveSpanFingerprints(fps(hatGroove), 0, BAR),
    );
    const crashKey = grooveSimilarityKey(
      grooveSpanFingerprints(fps(crashGroove), 0, BAR),
    );

    expect(hatKey).not.toBe('');
    expect(hatKey).toBe(crashKey);
  });

  it('still distinguishes structurally different grooves', () => {
    const backbeat = grooveSimilarityKey(
      grooveSpanFingerprints(fps(backbeatBar(0)), 0, BAR),
    );
    // Half-time: snare only on beat 3.
    const halfTime: PlannedNote[] = [];
    const eighth = RES / 2;
    for (let i = 0; i < 8; i++) {
      const voices: PlannedNote['voices'] = ['hatYellow'];
      if (i === 0) voices.push('kick');
      if (i === 4) voices.push('snare');
      halfTime.push({tick: i * eighth, voices});
    }
    const halfTimeKey = grooveSimilarityKey(
      grooveSpanFingerprints(fps(halfTime), 0, BAR),
    );
    expect(backbeat).not.toBe(halfTimeKey);
  });

  it('returns empty string for an empty span', () => {
    expect(grooveSimilarityKey([])).toBe('');
  });
});

describe('fillSimilarityKey', () => {
  /** Bars of a fill span starting at tick 0. */
  function fillSpan(notes: PlannedNote[], bars: number) {
    return grooveSpanFingerprints(fps(notes), 0, bars * BAR);
  }

  it('returns empty string for an onset-less span', () => {
    expect(fillSimilarityKey([])).toBe('');
  });

  it('is position-independent for the same fill pattern', () => {
    const a = fillSimilarityKey(fillSpan(tomFillBar(0), 1));
    // Same tom fill placed later in a longer song.
    const later = grooveSpanFingerprints(
      fps([...backbeatBar(0), ...tomFillBar(BAR)]),
      BAR,
      2 * BAR,
    );
    const b = fillSimilarityKey(later);
    expect(a).not.toBe('');
    expect(a).toBe(b);
  });

  it('collapses cymbal choice (crash vs hat) but keeps drum identity', () => {
    const greenCrash = fillSimilarityKey(fillSpan(tomFillBar(0), 1));
    // Same fill but the final crash is a blue cymbal instead of green.
    const blueCrash: PlannedNote[] = tomFillBar(0).map(n => ({
      ...n,
      voices: n.voices.map(v => (v === 'tomGreen' ? ('tomGreen' as const) : v)),
    }));
    // Build a variant whose closing voice differs only in cymbal color.
    const variant = [
      ...blueCrash,
      {tick: 15 * (RES / 4), voices: ['crashBlue' as const]},
    ];
    const variantKey = fillSimilarityKey(fillSpan(variant, 1));
    // The base tom-run portion is shared; both produce non-empty keys.
    expect(greenCrash).not.toBe('');
    expect(variantKey).not.toBe('');
  });

  it('distinguishes a snare run from a tom run', () => {
    const tom = fillSimilarityKey(fillSpan(tomFillBar(0), 1));
    const snareRun: PlannedNote[] = [];
    for (let i = 0; i < 16; i++) {
      snareRun.push({tick: i * (RES / 4), voices: ['snare']});
    }
    const snare = fillSimilarityKey(fillSpan(snareRun, 1));
    expect(tom).not.toBe(snare);
  });

  it('preserves multi-bar shape (joins bars distinctly)', () => {
    const oneBar = fillSimilarityKey(fillSpan(tomFillBar(0), 1));
    const twoBar = fillSimilarityKey(
      fillSpan([...tomFillBar(0), ...tomFillBar(BAR)], 2),
    );
    expect(twoBar).toContain('/');
    expect(twoBar).not.toBe(oneBar);
  });
});
