/**
 * Unit tests for the 5-fret calculator: one per feature on hand-built onsets,
 * the null cases, determinism and bounds, and a golden test on the synthetic
 * fixture chart cross-checked against the research extractor the corpus
 * constants were fitted with.
 */

import {readFileSync, existsSync} from 'fs';
import path from 'path';

import {noteFlags, noteTypes, readChart} from '@/lib/chart-edit';
import type {NoteEvent, NoteType} from '@/lib/chart-edit';

import {
  AXIS_CALIBRATION,
  AXIS_WEIGHTS,
  FRET_CORE_FEATURES,
  FROZEN_STATS,
  MIN_SCORABLE_NOTES,
  calculateExpertFretDifficulty,
  calculateFromOnsets,
  calibratedComplexityScore,
  complexityScore,
  computeFretFeatures,
  estimateTier,
  featureContribution,
  isFretLane,
  recommendedFretSongIniScores,
  trackToOnsets,
  type FretOnset,
  type TempoPoint,
} from '../fretDifficulty';

const TEMPOS: TempoPoint[] = [{ms: 0, bpm: 120}];

function note(
  type: NoteType,
  {
    flags = noteFlags.strum,
    msLength = 0,
  }: {flags?: number; msLength?: number} = {},
): Pick<NoteEvent, 'type' | 'flags' | 'msLength'> {
  return {type, flags, msLength};
}

function onset(
  ms: number,
  types: NoteType[],
  options: {flags?: number; msLength?: number} = {},
): FretOnset {
  return {
    ms,
    lanes: new Set<number>(types),
    notes: types.map(type => note(type, options)),
  };
}

/** A quarter-note green stream at 120bpm: one onset every 500ms. */
function stream(
  count: number,
  stepMs = 500,
  type: NoteType = noteTypes.green,
): FretOnset[] {
  return Array.from({length: count}, (_, i) => onset(i * stepMs, [type]));
}

// ---------------------------------------------------------------------------
// Lane vocabulary
// ---------------------------------------------------------------------------

describe('isFretLane', () => {
  it('accepts open and the five frets', () => {
    for (const type of [
      noteTypes.open,
      noteTypes.green,
      noteTypes.red,
      noteTypes.yellow,
      noteTypes.blue,
      noteTypes.orange,
    ]) {
      expect(isFretLane(type)).toBe(true);
    }
  });

  it('rejects drum and 6-fret note types', () => {
    for (const type of [
      noteTypes.kick,
      noteTypes.redDrum,
      noteTypes.black1,
      noteTypes.white3,
    ]) {
      expect(isFretLane(type)).toBe(false);
    }
  });
});

describe('trackToOnsets', () => {
  it('groups notes by millisecond regardless of how the chart grouped them', () => {
    const onsets = trackToOnsets({
      noteEventGroups: [
        [
          {
            tick: 0,
            length: 0,
            type: noteTypes.red,
            flags: 0,
            msTime: 100,
            msLength: 0,
          },
        ],
        [
          {
            tick: 0,
            length: 0,
            type: noteTypes.green,
            flags: 0,
            msTime: 100,
            msLength: 0,
          },
        ],
        [
          {
            tick: 96,
            length: 0,
            type: noteTypes.blue,
            flags: 0,
            msTime: 50,
            msLength: 0,
          },
        ],
      ],
    } as never);

    expect(onsets.map(o => o.ms)).toEqual([50, 100]);
    expect([...onsets[1]!.lanes].sort()).toEqual([
      noteTypes.green,
      noteTypes.red,
    ]);
  });

  it('drops note types that are not 5-fret lanes', () => {
    const onsets = trackToOnsets({
      noteEventGroups: [
        [
          {
            tick: 0,
            length: 0,
            type: noteTypes.kick,
            flags: 0,
            msTime: 0,
            msLength: 0,
          },
        ],
      ],
    } as never);
    expect(onsets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Features, one at a time
// ---------------------------------------------------------------------------

describe('computeFretFeatures', () => {
  it('returns a complete zero vector with has_notes = 0 for an empty tier', () => {
    const features = computeFretFeatures([], TEMPOS);
    expect(features.has_notes).toBe(0);
    expect(features.n_notes).toBe(0);
    for (const feature of FRET_CORE_FEATURES) {
      expect(features[feature]).toBe(0);
    }
  });

  it('counts notes and onsets separately, so chords do not inflate onset density', () => {
    const features = computeFretFeatures(
      [
        onset(0, [noteTypes.green, noteTypes.red]),
        onset(1000, [noteTypes.green, noteTypes.red]),
        onset(2000, [noteTypes.green]),
      ],
      TEMPOS,
    );
    expect(features.n_notes).toBe(5);
    expect(features.n_onsets).toBe(3);
    expect(features.active_seconds).toBeCloseTo(2, 10);
    expect(features.onset_density).toBeCloseTo(1.5, 10);
    expect(features.note_density).toBeCloseTo(2.5, 10);
  });

  it('measures peak density over a two-bar window normalized by the bar', () => {
    // Eight notes packed into the first bar, then silence. At 120bpm a bar is
    // 2s, so the two-bar window is 4s and the p95 window holds all eight.
    const onsets = [
      ...Array.from({length: 8}, (_, i) => onset(i * 250, [noteTypes.green])),
      onset(20000, [noteTypes.green]),
    ];
    const features = computeFretFeatures(onsets, TEMPOS);
    // Window counts run 8,7,6,5,4,3,2,1 over the burst plus 1 for the trailing
    // note; the p95 of those nine interpolates to 7.6, over a 4s window.
    expect(features.peak_density_p95).toBeCloseTo(7.6 / 4, 10);
  });

  it('reports fine_frac and burst_frac over inter-onset gaps', () => {
    // Gaps: 100, 100, 1000 — two are <= 100ms and therefore also <= 125ms.
    const features = computeFretFeatures(
      [
        onset(0, [noteTypes.green]),
        onset(100, [noteTypes.green]),
        onset(200, [noteTypes.green]),
        onset(1200, [noteTypes.green]),
      ],
      TEMPOS,
    );
    expect(features.fine_frac).toBeCloseTo(2 / 3, 10);
    expect(features.burst_frac_100ms).toBeCloseTo(2 / 3, 10);
    expect(features.p10_ioi_ms).toBeCloseTo(100, 10);
  });

  it('measures chord size and share from simultaneous lanes', () => {
    const features = computeFretFeatures(
      [
        onset(0, [noteTypes.green, noteTypes.red, noteTypes.yellow]),
        onset(500, [noteTypes.green]),
        onset(1000, [noteTypes.green, noteTypes.red]),
        onset(1500, [noteTypes.green]),
      ],
      TEMPOS,
    );
    expect(features.mean_chord_size).toBeCloseTo(7 / 4, 10);
    expect(features.chord_frac).toBeCloseTo(0.5, 10);
    expect(features.peak_chord_p95).toBeCloseTo(2.85, 10);
  });

  it('counts a tap as a tap and not twice in hopo_tap_frac', () => {
    const features = computeFretFeatures(
      [
        onset(0, [noteTypes.green], {flags: noteFlags.tap}),
        onset(500, [noteTypes.red], {flags: noteFlags.hopo}),
        onset(1000, [noteTypes.blue], {flags: noteFlags.strum}),
        onset(1500, [noteTypes.blue], {flags: noteFlags.tap | noteFlags.hopo}),
      ],
      TEMPOS,
    );
    expect(features.tap_frac).toBeCloseTo(0.5, 10);
    expect(features.hopo_tap_frac).toBeCloseTo(0.75, 10);
  });

  it('counts open notes per onset', () => {
    const features = computeFretFeatures(
      [
        onset(0, [noteTypes.open]),
        onset(500, [noteTypes.green]),
        onset(1000, [noteTypes.open]),
        onset(1500, [noteTypes.green]),
      ],
      TEMPOS,
    );
    expect(features.open_frac).toBeCloseTo(0.5, 10);
  });

  it('treats a note as a sustain only once it is held past the floor', () => {
    const features = computeFretFeatures(
      [
        onset(0, [noteTypes.green], {msLength: 400}),
        onset(1000, [noteTypes.green], {msLength: 99}),
        onset(2000, [noteTypes.green], {msLength: 0}),
        onset(3000, [noteTypes.green], {msLength: 100}),
      ],
      TEMPOS,
    );
    expect(features.sustain_frac).toBeCloseTo(0.5, 10);
    expect(features.sustain_time_frac).toBeCloseTo(500 / 3000, 10);
  });

  it('measures fret span across the lanes held together', () => {
    const features = computeFretFeatures(
      [
        onset(0, [noteTypes.green, noteTypes.orange]),
        onset(1000, [noteTypes.green]),
      ],
      TEMPOS,
    );
    // green(2) .. orange(6) spans 4; the single note spans 0.
    expect(features.fret_span_mean).toBeCloseTo(2, 10);
  });

  it('does not count open notes as a fretted position for span or anchoring', () => {
    const features = computeFretFeatures(
      [
        onset(0, [noteTypes.open, noteTypes.green]),
        onset(1000, [noteTypes.green]),
      ],
      TEMPOS,
    );
    expect(features.fret_span_mean).toBe(0);
    expect(features.anchor_break_per_bar).toBe(0);
  });

  it('counts an anchor break when the lowest fret moves two or more lanes', () => {
    // green -> red is one lane (no break); red -> orange is three (break).
    const onsets = [
      onset(0, [noteTypes.green]),
      onset(500, [noteTypes.red]),
      onset(1000, [noteTypes.orange]),
      onset(1500, [noteTypes.orange]),
    ];
    const features = computeFretFeatures(onsets, TEMPOS);
    // 1500ms span at 120bpm 4/4 = 0.75 bars, floored to one bar by the rate.
    expect(features.anchor_break_per_bar).toBeCloseTo(1, 10);
    // Two of the four onsets differ from their predecessor; the repeated
    // orange does not.
    expect(features.lane_switch_per_bar).toBeCloseTo(2, 10);
  });

  it('reads the bar length from the first tempo, not the default', () => {
    const alternating = [
      onset(0, [noteTypes.green]),
      onset(500, [noteTypes.red]),
      onset(1000, [noteTypes.green]),
      onset(1500, [noteTypes.red]),
      onset(2000, [noteTypes.green]),
    ];
    const slow = computeFretFeatures(alternating, [{ms: 0, bpm: 60}]);
    const fast = computeFretFeatures(alternating, [{ms: 0, bpm: 240}]);
    // A faster chart packs more bars into the same span, so the same absolute
    // switch count becomes a lower per-bar rate.
    expect(fast.lane_switch_per_bar).toBeLessThan(slow.lane_switch_per_bar);
  });

  it('is deterministic and independent of input order', () => {
    const onsets = [
      onset(1000, [noteTypes.red]),
      onset(0, [noteTypes.green]),
      onset(500, [noteTypes.yellow, noteTypes.blue]),
    ];
    expect(computeFretFeatures(onsets, TEMPOS)).toEqual(
      computeFretFeatures([...onsets].reverse(), TEMPOS),
    );
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('scoring', () => {
  it('scores an empty tier as null rather than 0', () => {
    const features = computeFretFeatures([], TEMPOS);
    expect(complexityScore(features, 'guitar')).toBeNull();
    expect(calibratedComplexityScore(features, 'guitar')).toBeNull();
    expect(estimateTier(null)).toBeNull();
  });

  it('refuses to score a tier below the corpus note floor', () => {
    const stub = computeFretFeatures(stream(MIN_SCORABLE_NOTES - 1), TEMPOS);
    expect(stub.n_notes).toBe(MIN_SCORABLE_NOTES - 1);
    expect(stub.has_notes).toBe(1);
    expect(complexityScore(stub, 'guitar')).toBeNull();

    const real = computeFretFeatures(stream(MIN_SCORABLE_NOTES), TEMPOS);
    expect(complexityScore(real, 'guitar')).not.toBeNull();
  });

  it('is the weighted sum of the frozen z-scores', () => {
    const features = computeFretFeatures(stream(64), TEMPOS);
    const expected = FRET_CORE_FEATURES.reduce((total, feature) => {
      const [mean, sd] = FROZEN_STATS.guitar[feature];
      return (
        total + (AXIS_WEIGHTS.guitar[feature] * (features[feature] - mean)) / sd
      );
    }, 0);
    expect(complexityScore(features, 'guitar')).toBeCloseTo(expected, 12);
  });

  it('reports each feature contribution as weight times z', () => {
    const features = computeFretFeatures(stream(64), TEMPOS);
    const total = FRET_CORE_FEATURES.reduce(
      (sum, feature) => sum + featureContribution(features, 'guitar', feature),
      0,
    );
    expect(total).toBeCloseTo(complexityScore(features, 'guitar')!, 12);
  });

  it('applies the calibration for the instrument being scored', () => {
    const features = computeFretFeatures(stream(64), TEMPOS);
    for (const instrument of ['guitar', 'bass'] as const) {
      const {intercept, slope} = AXIS_CALIBRATION[instrument];
      expect(calibratedComplexityScore(features, instrument)).toBeCloseTo(
        intercept + slope * complexityScore(features, instrument)!,
        12,
      );
    }
  });

  it('gives guitar and bass different answers for the same chart', () => {
    const features = computeFretFeatures(stream(64), TEMPOS);
    expect(calibratedComplexityScore(features, 'bass')).not.toBeCloseTo(
      calibratedComplexityScore(features, 'guitar')!,
      3,
    );
  });

  it('clips the tier to the 0-6 metadata scale', () => {
    expect(estimateTier(-40)).toBe(0);
    expect(estimateTier(40)).toBe(6);
    expect(estimateTier(2.5)).toBe(3);
    expect(estimateTier(2.49)).toBe(2);
  });

  it('never returns a tier outside 0-6 for extreme charts', () => {
    const empty = calculateFromOnsets(stream(400, 4000), 'guitar', TEMPOS);
    const frantic = calculateFromOnsets(
      Array.from({length: 4000}, (_, i) =>
        onset(i * 30, [noteTypes.green, noteTypes.red], {flags: noteFlags.tap}),
      ),
      'guitar',
      TEMPOS,
    );
    for (const result of [empty, frantic]) {
      expect(result.estimatedDifficulty).toBeGreaterThanOrEqual(0);
      expect(result.estimatedDifficulty).toBeLessThanOrEqual(6);
    }
    expect(frantic.estimatedDifficulty!).toBeGreaterThan(
      empty.estimatedDifficulty!,
    );
  });
});

describe('calculateExpertFretDifficulty', () => {
  const chart = {
    tempos: [{tick: 0, msTime: 0, beatsPerMinute: 120}],
    trackData: [
      {
        instrument: 'guitar',
        difficulty: 'expert',
        noteEventGroups: stream(64).map(o => [
          {
            tick: 0,
            length: 0,
            type: noteTypes.green,
            flags: noteFlags.strum,
            msTime: o.ms,
            msLength: 0,
          },
        ]),
      },
    ],
  } as never;

  it('returns null when the instrument has no Expert track at all', () => {
    expect(calculateExpertFretDifficulty(chart, 'bass')).toBeNull();
  });

  it('scores the Expert track it does find', () => {
    const result = calculateExpertFretDifficulty(chart, 'guitar');
    expect(result).not.toBeNull();
    expect(result!.instrument).toBe('guitar');
    expect(result!.features.n_notes).toBe(64);
  });

  it('recommends null, never 0, for a missing arrangement', () => {
    expect(recommendedFretSongIniScores(chart).diff_bass).toBeNull();
    expect(recommendedFretSongIniScores(chart).diff_guitar).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Golden test on the synthetic fixture chart
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(
  __dirname,
  '..',
  '__fixtures__',
  'fret-synthetic-01',
);
const hasFixture = existsSync(path.join(FIXTURE_DIR, 'notes.chart'));

(hasFixture ? describe : describe.skip)('golden fixture', () => {
  function loadFixture() {
    return readChart([
      {
        fileName: 'notes.chart',
        data: new Uint8Array(
          readFileSync(path.join(FIXTURE_DIR, 'notes.chart')),
        ),
      },
      {
        fileName: 'song.ini',
        data: new Uint8Array(readFileSync(path.join(FIXTURE_DIR, 'song.ini'))),
      },
    ] as never);
  }

  it.each(['guitar', 'bass'] as const)(
    'scores the synthetic Expert %s chart to frozen values',
    instrument => {
      const golden = GOLDEN[instrument];
      const result = calculateExpertFretDifficulty(
        loadFixture().parsedChart,
        instrument,
      );

      expect(result).not.toBeNull();
      expect(result!.features.n_notes).toBe(golden.n_notes);
      expect(result!.features.n_onsets).toBe(golden.n_onsets);
      for (const feature of FRET_CORE_FEATURES) {
        expect(result!.features[feature]).toBeCloseTo(golden[feature], 12);
      }
      expect(result!.complexityScore).toBeCloseTo(golden.axis, 12);
      expect(result!.calibratedComplexityScore).toBeCloseTo(
        golden.calibrated,
        12,
      );
      expect(result!.estimatedDifficulty).toBe(golden.tier);
    },
  );

  it('recommends the frozen tiers for both arrangements', () => {
    expect(recommendedFretSongIniScores(loadFixture().parsedChart)).toEqual({
      diff_guitar: GOLDEN.guitar.tier,
      diff_bass: GOLDEN.bass.tier,
    });
  });
});

/**
 * Produced by the `drum-to-chart` research repo's
 * `analysis/fret_difficulty/parity.mjs` run on this fixture, which is the
 * extractor the corpus constants were fitted with. A change here means the
 * calculator drifted from the fit, not that the fixture changed.
 */
const GOLDEN: Record<
  'guitar' | 'bass',
  Record<(typeof FRET_CORE_FEATURES)[number], number> & {
    n_notes: number;
    n_onsets: number;
    axis: number;
    calibrated: number;
    tier: number;
  }
> = {
  guitar: {
    n_notes: 209,
    n_onsets: 177,
    onset_density: 3.833333333333333,
    peak_density_p95: 6.875,
    fine_frac: 0.36363636363636365,
    mean_chord_size: 1.1807909604519775,
    hopo_tap_frac: 0.36363636363636365,
    sustain_frac: 0.15789473684210525,
    anchor_break_per_bar: 2.4429378531073445,
    lane_switch_per_bar: 8.836158192090394,
    axis: 0.022961035766185217,
    calibrated: 3.223190646123847,
    tier: 3,
  },
  bass: {
    n_notes: 165,
    n_onsets: 158,
    onset_density: 3.4708691499522444,
    peak_density_p95: 5.833333333333334,
    fine_frac: 0.20382165605095542,
    mean_chord_size: 1.0443037974683544,
    hopo_tap_frac: 0.1393939393939394,
    sustain_frac: 0.12121212121212122,
    anchor_break_per_bar: 4.006876790830945,
    lane_switch_per_bar: 6.801146131805157,
    axis: 0.578806423795754,
    calibrated: 2.9088064237957543,
    tier: 3,
  },
};
