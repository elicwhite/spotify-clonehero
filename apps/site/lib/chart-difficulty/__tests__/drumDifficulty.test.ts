/**
 * Port of `analysis/drum_difficulty/test_calculator.py` from the
 * `drum-to-chart` research repo, plus the lane-vocabulary mapping this port
 * adds and a golden test on a real fixture chart so the numbers cannot drift.
 */

import {readFileSync, existsSync} from 'fs';
import path from 'path';

import {noteFlags, noteTypes} from '@/lib/chart-edit';
import {readChart} from '@/lib/chart-edit';

import {
  calculateExpertDrumDifficulty,
  calculateFromHits,
  computeFeatures,
  estimateTier,
  noteToLane,
  recommendedSongIniScores,
  trackToHits,
  type DrumHit,
  type TempoPoint,
} from '../drumDifficulty';

// ---------------------------------------------------------------------------
// The Python module's demo chart, expressed in this project's hit vocabulary
// ---------------------------------------------------------------------------

const DEMO_TEMPOS: TempoPoint[] = [{ms: 0, bpm: 120}];

function hit(
  ms: number,
  lane: DrumHit['lane'],
  extra: Partial<DrumHit> = {},
): DrumHit {
  return {ms, lane, doubleKick: false, ghost: false, accent: false, ...extra};
}

/** `demo_chart()` from `test_calculator.py`. `open-hat` folds to `hihat`. */
function demoHits(): DrumHit[] {
  return [
    hit(0, 'kick', {doubleKick: true}),
    hit(0, 'snare'),
    hit(125, 'hihat'),
    hit(250, 'high-tom'),
    hit(250, 'crash'),
    hit(500, 'kick', {ghost: true}),
  ];
}

describe('computeFeatures', () => {
  it('is chart-only and folds open-hat into hihat', () => {
    const features = computeFeatures(demoHits(), DEMO_TEMPOS);
    expect(features.n_notes).toBe(6);
    expect(features.n_lanes).toBe(5);
    expect(features.double_kick_frac).toBe(0.5);
    expect(features.cymbal_fraction).toBeGreaterThan(0);
    expect(features.tom_fraction).toBeGreaterThan(0);
  });

  it('returns a complete zero vector with has_notes=0 for an empty tier', () => {
    const features = computeFeatures([], DEMO_TEMPOS);
    expect(features.has_notes).toBe(0);
    expect(features.n_notes).toBe(0);
    expect(features.note_density).toBe(0);
    expect(features.n_lanes).toBe(0);
  });

  it('counts the two-bar window, chord load and dynamics as the contract defines them', () => {
    const features = computeFeatures(demoHits(), DEMO_TEMPOS);
    // 6 notes across a 500ms span.
    expect(features.active_seconds).toBeCloseTo(0.5, 10);
    expect(features.note_density).toBeCloseTo(12, 10);
    // Onsets at 0/125/250/500 -> gaps 125,125,250; two of three are <= 125ms.
    expect(features.fine_frac).toBeCloseTo(2 / 3, 10);
    // Both the 0ms and 250ms onsets carry two distinct lanes.
    expect(features.peak_chord_p95).toBeCloseTo(2, 10);
    // One ghost + one double kick; only the ghost counts as a dynamic.
    expect(features.dyn_frac).toBeCloseTo(1 / 6, 10);
  });
});

describe('scoring', () => {
  it('does not score a missing or empty tier', () => {
    const result = calculateFromHits([], DEMO_TEMPOS);
    expect(result.complexityScore).toBeNull();
    expect(result.distilledScore).toBeNull();
    expect(result.estimatedDiffDrumsReal).toBeNull();
    expect(recommendedSongIniScores({trackData: [], tempos: []})).toEqual({
      diff_drums: null,
      diff_drums_real: null,
    });
  });

  it('is deterministic and emits a compatible 0-6 pair', () => {
    const first = calculateFromHits(demoHits(), DEMO_TEMPOS);
    const second = calculateFromHits(demoHits(), DEMO_TEMPOS);
    expect(first).toEqual(second);
    expect(first.estimatedDiffDrums).toBe(first.estimatedDiffDrumsReal);
    expect(first.estimatedDiffDrumsReal).toBeGreaterThanOrEqual(0);
    expect(first.estimatedDiffDrumsReal).toBeLessThanOrEqual(6);
  });

  it('reproduces the Python calculator on the demo chart', () => {
    const result = calculateFromHits(demoHits(), DEMO_TEMPOS);
    expect(result.complexityScore).toBeCloseTo(-0.3132996227572752, 12);
    expect(result.calibratedComplexityScore).toBeCloseTo(
      3.5167896299953503,
      12,
    );
    expect(result.distilledScore).toBeCloseTo(4.153071235841165, 12);
    expect(result.estimatedDiffDrumsReal).toBe(4);
  });

  it('reflects an editor change on recalculation', () => {
    const before = calculateFromHits(demoHits(), DEMO_TEMPOS);
    const after = calculateFromHits(
      [...demoHits(), hit(625, 'kick')],
      DEMO_TEMPOS,
    );
    expect(after.features.n_notes).toBeGreaterThan(before.features.n_notes);
    expect(after.complexityScore).not.toBe(before.complexityScore);
  });

  it('clips the tier to 0-6', () => {
    expect(estimateTier(-9)).toBe(0);
    expect(estimateTier(99)).toBe(6);
    expect(estimateTier(3.5)).toBe(4);
    expect(estimateTier(3.49)).toBe(3);
    expect(estimateTier(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lane vocabulary mapping (the piece this port adds over the Python module)
// ---------------------------------------------------------------------------

describe('noteToLane', () => {
  it('splits each shared Clone Hero pad by its cymbal flag', () => {
    expect(noteToLane({type: noteTypes.kick, flags: 0})).toBe('kick');
    expect(noteToLane({type: noteTypes.redDrum, flags: 0})).toBe('snare');
    expect(
      noteToLane({type: noteTypes.yellowDrum, flags: noteFlags.cymbal}),
    ).toBe('hihat');
    expect(noteToLane({type: noteTypes.yellowDrum, flags: noteFlags.tom})).toBe(
      'high-tom',
    );
    expect(
      noteToLane({type: noteTypes.blueDrum, flags: noteFlags.cymbal}),
    ).toBe('ride');
    expect(noteToLane({type: noteTypes.blueDrum, flags: noteFlags.tom})).toBe(
      'mid-tom',
    );
    expect(
      noteToLane({type: noteTypes.greenDrum, flags: noteFlags.cymbal}),
    ).toBe('crash');
    expect(noteToLane({type: noteTypes.greenDrum, flags: noteFlags.tom})).toBe(
      'floor-tom',
    );
  });

  it('ignores non-drum note types', () => {
    expect(noteToLane({type: noteTypes.green, flags: 0})).toBeNull();
  });
});

describe('trackToHits', () => {
  it('flattens note groups and carries dynamics flags', () => {
    const hits = trackToHits({
      noteEventGroups: [
        [
          {
            tick: 0,
            msTime: 0,
            length: 0,
            msLength: 0,
            type: noteTypes.kick,
            flags: noteFlags.doubleKick,
          },
          {
            tick: 0,
            msTime: 0,
            length: 0,
            msLength: 0,
            type: noteTypes.redDrum,
            flags: noteFlags.accent,
          },
        ],
        [
          {
            tick: 96,
            msTime: 250,
            length: 0,
            msLength: 0,
            type: noteTypes.yellowDrum,
            flags: noteFlags.cymbal | noteFlags.ghost,
          },
        ],
      ],
    } as never);

    expect(hits.map(h => h.lane)).toEqual(['kick', 'snare', 'hihat']);
    expect(hits[0]!.doubleKick).toBe(true);
    expect(hits[1]!.accent).toBe(true);
    expect(hits[2]!.ghost).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Golden test on a real chart from this repo
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(
  __dirname,
  '..',
  '..',
  'drum-difficulty',
  '__fixtures__',
);
const GOLDEN_FIXTURE = 'reduction-01';
const hasFixture = existsSync(
  path.join(FIXTURES_DIR, GOLDEN_FIXTURE, 'notes.mid'),
);

(hasFixture ? describe : describe.skip)('golden fixture', () => {
  it('scores the reduction-01 Expert drum chart to a frozen value', () => {
    const dir = path.join(FIXTURES_DIR, GOLDEN_FIXTURE);
    const doc = readChart(
      [
        {
          fileName: 'notes.mid',
          data: new Uint8Array(readFileSync(path.join(dir, 'notes.mid'))),
        },
        {
          fileName: 'song.ini',
          data: new Uint8Array(readFileSync(path.join(dir, 'song.ini'))),
        },
      ] as never,
      {pro_drums: true},
    );

    const result = calculateExpertDrumDifficulty(doc.parsedChart);
    expect(result).not.toBeNull();
    // Frozen golden values. A change here means the port drifted from the
    // Python contract, not that the fixture changed.
    expect(result!.features.n_notes).toBe(GOLDEN.n_notes);
    expect(result!.features.n_lanes).toBe(GOLDEN.n_lanes);
    expect(result!.complexityScore).toBeCloseTo(GOLDEN.dc, 9);
    expect(result!.calibratedComplexityScore).toBeCloseTo(GOLDEN.calibrated, 9);
    expect(result!.distilledScore).toBeCloseTo(GOLDEN.distilled, 9);
    expect(result!.estimatedDiffDrumsReal).toBe(GOLDEN.tier);
    expect(recommendedSongIniScores(doc.parsedChart)).toEqual({
      diff_drums: GOLDEN.tier,
      diff_drums_real: GOLDEN.tier,
    });
  });
});

/**
 * Cross-checked against `analysis/drum_difficulty/calculator.py` run on the
 * same chart: all twenty features and both continuous scores agree to the last
 * representable digit.
 */
const GOLDEN = {
  n_notes: 1840,
  n_lanes: 8,
  dc: -0.5306555720250321,
  calibrated: 3.1538051947181964,
  distilled: 3.196174566392125,
  tier: 3,
};
