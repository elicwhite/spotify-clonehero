/**
 * Unit tests for the "Ours" v3 featurizer: exact column order (incl. the
 * duplicate `section_prechorus`), the `chord_has_<lane>` and `aug_*` columns,
 * and a few numeric features on a small hand-built chart.
 */

import {readFileSync} from 'fs';
import {join} from 'path';
import {
  FEATURE_NAMES,
  featurizeSong,
  familyOfLane,
  type OursSongInput,
} from '../featurize';

const idx = (name: string): number => FEATURE_NAMES.indexOf(name);
const allIdx = (name: string): number[] =>
  FEATURE_NAMES.flatMap((n, i) => (n === name ? [i] : []));

describe('Ours featurizer — column layout', () => {
  test('FEATURE_NAMES matches feature_names_v5.json exactly', () => {
    const shipped = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '..',
          '..',
          'public',
          'models',
          'drum-difficulty',
          'v5',
          'feature_names_v5.json',
        ),
        'utf8',
      ),
    ).feature_names as string[];
    expect(FEATURE_NAMES).toEqual(shipped);
    expect(FEATURE_NAMES).toHaveLength(59);
  });

  test('section_prechorus appears at two distinct columns', () => {
    expect(allIdx('section_prechorus')).toEqual([25, 26]);
  });

  test('era_RB4 is the only era column', () => {
    expect(idx('era_RB4')).toBe(38);
  });
});

describe('Ours featurizer — feature values on a hand-built chart', () => {
  // 120 BPM, 4/4 -> 500 ms per beat, 2000 ms per measure. Resolution-free:
  // the featurizer works purely in ms via the tempo map.
  const base: Pick<OursSongInput, 'tempos' | 'timeSignatures' | 'resolution'> =
    {
      tempos: [{ms: 0, bpm: 120}],
      timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
      resolution: 480,
    };

  test('a kick+snare downbeat chord: chord_size, downbeat, lanes, chord_has', () => {
    const input: OursSongInput = {
      ...base,
      sections: [{ms: 0, name: 'Verse 1'}],
      notes: [
        // Measure 0, beat 0 (downbeat): kick + snare chord.
        {
          tick: 0,
          ms: 0,
          lane: 'kick',
          ghost: false,
          accent: false,
          flam: false,
        },
        {
          tick: 0,
          ms: 0,
          lane: 'snare',
          ghost: false,
          accent: false,
          flam: false,
        },
        // Beat 1 (500 ms): a lone hihat.
        {
          tick: 480,
          ms: 500,
          lane: 'hihat',
          ghost: false,
          accent: false,
          flam: false,
        },
      ],
    };
    const rows = featurizeSong(input);
    expect(rows).toHaveLength(3);

    // Rows sort by (ms, lane): [kick@0, snare@0, hihat@500].
    const [kick, snare, hihat] = rows;
    expect(kick.lane).toBe('kick');
    expect(snare.lane).toBe('snare');
    expect(hihat.lane).toBe('hihat');

    // chord_size = 2 for the chord notes, 1 for the lone hihat.
    expect(kick.features[idx('chord_size')]).toBe(2);
    expect(snare.features[idx('chord_size')]).toBe(2);
    expect(hihat.features[idx('chord_size')]).toBe(1);

    // Downbeat: beat_in_measure ~0 for the ms=0 chord, 1.0 for ms=500.
    expect(kick.features[idx('beat_in_measure')]).toBeCloseTo(0, 9);
    expect(kick.features[idx('is_downbeat')]).toBe(1);
    expect(hihat.features[idx('beat_in_measure')]).toBeCloseTo(1.0, 9);
    expect(hihat.features[idx('is_downbeat')]).toBe(0);
    expect(kick.features[idx('beats_per_measure')]).toBe(4);

    // Lane one-hots.
    expect(kick.features[idx('lane_kick')]).toBe(1);
    expect(kick.features[idx('lane_snare')]).toBe(0);
    expect(snare.features[idx('lane_snare')]).toBe(1);
    expect(hihat.features[idx('lane_hihat')]).toBe(1);

    // Section one-hot (Verse), including the duplicate prechorus staying 0.
    expect(kick.features[idx('section_verse')]).toBe(1);
    for (const i of allIdx('section_prechorus'))
      expect(kick.features[i]).toBe(0);

    // era hardcoded RB4.
    expect(kick.features[idx('era_RB4')]).toBe(1);
    expect(kick.features[idx('era_RB1')]).toBe(0);

    // chord_has: the kick's chord contains kick+snare (not hihat); the lone
    // hihat's chord contains only hihat.
    expect(kick.features[idx('chord_has_kick')]).toBe(1);
    expect(kick.features[idx('chord_has_snare')]).toBe(1);
    expect(kick.features[idx('chord_has_hihat')]).toBe(0);
    expect(snare.features[idx('chord_has_kick')]).toBe(1);
    expect(hihat.features[idx('chord_has_hihat')]).toBe(1);
    expect(hihat.features[idx('chord_has_kick')]).toBe(0);
  });

  test('chord_has reflects every lane in the same tick, not just the note lane', () => {
    const input: OursSongInput = {
      ...base,
      sections: [{ms: 0, name: 'Chorus'}],
      notes: [
        {
          tick: 0,
          ms: 0,
          lane: 'kick',
          ghost: false,
          accent: false,
          flam: false,
        },
        {
          tick: 0,
          ms: 0,
          lane: 'hihat',
          ghost: false,
          accent: false,
          flam: false,
        },
        {
          tick: 0,
          ms: 0,
          lane: 'crash',
          ghost: false,
          accent: false,
          flam: false,
        },
      ],
    };
    const rows = featurizeSong(input);
    for (const r of rows) {
      expect(r.features[idx('chord_has_kick')]).toBe(1);
      expect(r.features[idx('chord_has_hihat')]).toBe(1);
      expect(r.features[idx('chord_has_crash')]).toBe(1);
      expect(r.features[idx('chord_has_ride')]).toBe(0);
    }
    expect(
      rows.find(r => r.lane === 'kick')!.features[idx('section_chorus')],
    ).toBe(1);
  });

  test('gap and density features', () => {
    const input: OursSongInput = {
      ...base,
      sections: [{ms: 0, name: 'Intro'}],
      notes: [
        {
          tick: 0,
          ms: 0,
          lane: 'kick',
          ghost: false,
          accent: false,
          flam: false,
        },
        {
          tick: 240,
          ms: 250,
          lane: 'snare',
          ghost: false,
          accent: false,
          flam: false,
        },
        {
          tick: 480,
          ms: 500,
          lane: 'kick',
          ghost: false,
          accent: false,
          flam: false,
        },
      ],
    };
    const rows = featurizeSong(input);
    const [n0, n1] = rows; // ms 0, 250, 500
    // gaps
    expect(n0.features[idx('gap_prev_ms')]).toBe(0); // first note: prev==self
    expect(n0.features[idx('gap_next_ms')]).toBe(250);
    expect(n1.features[idx('gap_prev_ms')]).toBe(250);
    expect(n1.features[idx('gap_next_ms')]).toBe(250);
    // density within +/-250ms excluding self: n1 sees both neighbors.
    expect(n1.features[idx('local_density_500ms')]).toBe(2);
    expect(n0.features[idx('local_density_500ms')]).toBe(1);
  });

  test('ghost / accent / flam flags flow through', () => {
    const input: OursSongInput = {
      ...base,
      sections: [{ms: 0, name: 'Solo'}],
      notes: [
        {
          tick: 0,
          ms: 0,
          lane: 'snare',
          ghost: true,
          accent: false,
          flam: false,
        },
        {
          tick: 240,
          ms: 250,
          lane: 'snare',
          ghost: false,
          accent: true,
          flam: true,
        },
      ],
    };
    const [g, a] = featurizeSong(input);
    expect(g.features[idx('ghost')]).toBe(1);
    expect(g.features[idx('accent')]).toBe(0);
    expect(a.features[idx('accent')]).toBe(1);
    expect(a.features[idx('flam')]).toBe(1);
    expect(a.features[idx('section_solo')]).toBe(1);
  });
});

describe('familyOfLane', () => {
  test('classifies lanes into cymbal / tom / fixed', () => {
    expect(familyOfLane('hihat')).toBe('cymbal');
    expect(familyOfLane('open-hat')).toBe('cymbal');
    expect(familyOfLane('crash')).toBe('cymbal');
    expect(familyOfLane('ride')).toBe('cymbal');
    expect(familyOfLane('high-tom')).toBe('tom');
    expect(familyOfLane('floor-tom')).toBe('tom');
    expect(familyOfLane('kick')).toBe('fixed');
    expect(familyOfLane('snare')).toBe('fixed');
    expect(familyOfLane('other')).toBe('fixed');
  });
});
