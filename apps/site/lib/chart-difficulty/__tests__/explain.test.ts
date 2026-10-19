/**
 * Tests for the plain-English factor naming all three instruments share.
 */

import {readFileSync, existsSync} from 'fs';
import path from 'path';

import {noteFlags, noteTypes, readChart} from '@/lib/chart-edit';

import {
  DRUM_FACTOR_NAMES,
  FRET_FACTOR_NAMES,
  describeRecommendationFactors,
  explainRecommendation,
  recommendedDifficulty,
  type DifficultyExplanation,
} from '../explain';
import {CORE_FEATURES as DRUM_CORE_FEATURES} from '../drumDifficulty';
import {
  AXIS_WEIGHTS,
  FRET_CORE_FEATURES,
  calculateExpertFretDifficulty,
} from '../fretDifficulty';

function fretChart(
  instrument: 'guitar' | 'bass',
  onsetCount: number,
  stepMs = 250,
) {
  return {
    tempos: [{tick: 0, msTime: 0, beatsPerMinute: 120}],
    trackData: [
      {
        instrument,
        difficulty: 'expert',
        noteEventGroups: Array.from({length: onsetCount}, (_, i) => [
          {
            tick: i * 48,
            length: 0,
            type: i % 2 === 0 ? noteTypes.green : noteTypes.red,
            flags: noteFlags.strum,
            msTime: i * stepMs,
            msLength: 0,
          },
        ]),
      },
    ],
  } as never;
}

describe('factor name tables', () => {
  it('names every drum feature in plain English', () => {
    for (const feature of DRUM_CORE_FEATURES) {
      expect(DRUM_FACTOR_NAMES[feature]).toBeTruthy();
      // Plain English, not a variable name.
      expect(DRUM_FACTOR_NAMES[feature]).not.toMatch(/[_0-9]/);
    }
  });

  it('names every 5-fret feature in plain English', () => {
    for (const feature of FRET_CORE_FEATURES) {
      expect(FRET_FACTOR_NAMES[feature]).toBeTruthy();
      expect(FRET_FACTOR_NAMES[feature]).not.toMatch(/[_0-9]/);
    }
  });

  it('keeps the two tables consistent where they measure the same thing', () => {
    expect(FRET_FACTOR_NAMES.onset_density).toBe(
      DRUM_FACTOR_NAMES.note_density,
    );
    expect(FRET_FACTOR_NAMES.peak_density_p95).toBe(
      DRUM_FACTOR_NAMES.peak_density_p95,
    );
  });
});

describe('explainRecommendation', () => {
  it('returns null when there is no recommendation to explain', () => {
    const chart = fretChart('guitar', 64);
    expect(explainRecommendation(chart, 'bass')).toBeNull();
    expect(explainRecommendation(chart, 'drums')).toBeNull();
  });

  it('returns null for a track too small to score', () => {
    expect(explainRecommendation(fretChart('guitar', 8), 'guitar')).toBeNull();
  });

  it('reports the tier alongside the factors', () => {
    const chart = fretChart('guitar', 200);
    const explanation = explainRecommendation(chart, 'guitar')!;
    expect(explanation.instrument).toBe('guitar');
    expect(explanation.recommended).toBe(
      recommendedDifficulty(chart, 'guitar'),
    );
    expect(explanation.recommended).toBeGreaterThanOrEqual(0);
  });

  it('orders factors by absolute contribution', () => {
    const explanation = explainRecommendation(
      fretChart('guitar', 200),
      'guitar',
    )!;
    const magnitudes = explanation.factors.map(f => Math.abs(f.contribution));
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a));
  });

  it('names the top factors and counts the rest', () => {
    const explanation = explainRecommendation(
      fretChart('guitar', 200),
      'guitar',
    )!;
    expect(explanation.topFactors).toHaveLength(2);
    expect(explanation.topFactors).toEqual(
      explanation.factors.slice(0, 2).map(f => f.name),
    );
    expect(explanation.otherFactorCount).toBe(explanation.factors.length - 2);
    expect(explanation.topFactors.length + explanation.otherFactorCount).toBe(
      explanation.factors.length,
    );
  });

  it('honours a caller-chosen top-factor count', () => {
    const explanation = explainRecommendation(
      fretChart('guitar', 200),
      'guitar',
      3,
    )!;
    expect(explanation.topFactors).toHaveLength(3);
    expect(explanation.otherFactorCount).toBe(explanation.factors.length - 3);
  });

  it('never asks for more factors than exist', () => {
    const explanation = explainRecommendation(
      fretChart('guitar', 200),
      'guitar',
      99,
    )!;
    expect(explanation.topFactors).toHaveLength(explanation.factors.length);
    expect(explanation.otherFactorCount).toBe(0);
  });

  it('omits the features the instrument weights at zero', () => {
    const guitar = explainRecommendation(fretChart('guitar', 200), 'guitar')!;
    const bass = explainRecommendation(fretChart('bass', 200), 'bass')!;
    const zeroWeighted = FRET_CORE_FEATURES.filter(
      f => AXIS_WEIGHTS.guitar[f] === 0,
    );
    expect(zeroWeighted.length).toBeGreaterThan(0);
    for (const feature of zeroWeighted) {
      expect(guitar.factors.map(f => f.feature)).not.toContain(feature);
    }
    expect(guitar.factors).toHaveLength(
      FRET_CORE_FEATURES.length - zeroWeighted.length,
    );
    expect(bass.factors).toHaveLength(FRET_CORE_FEATURES.length);
  });

  it('signs contributions so a UI can say "fewer", not just "some"', () => {
    const sparse = explainRecommendation(
      fretChart('guitar', 200, 2000),
      'guitar',
    )!;
    const density = sparse.factors.find(f => f.feature === 'onset_density')!;
    // A note every two seconds is far below the corpus mean, so density
    // pushed this chart's estimate DOWN.
    expect(density.contribution).toBeLessThan(0);
  });

  it('the contributions sum to the intrinsic axis', () => {
    const chart = fretChart('bass', 200);
    const explanation = explainRecommendation(chart, 'bass')!;
    const total = explanation.factors.reduce(
      (sum, f) => sum + f.contribution,
      0,
    );
    // Bass weights nothing at zero, so the factor list is the whole axis.
    expect(explanation.factors).toHaveLength(FRET_CORE_FEATURES.length);
    expect(total).toBeCloseTo(
      calculateExpertFretDifficulty(chart, 'bass')!.complexityScore!,
      12,
    );
  });
});

describe('describeRecommendationFactors', () => {
  function explanation(
    overrides: Partial<DifficultyExplanation>,
  ): DifficultyExplanation {
    return {
      instrument: 'guitar',
      recommended: 3,
      factors: [],
      topFactors: [],
      otherFactorCount: 0,
      ...overrides,
    };
  }

  it('names the top factors and counts the rest', () => {
    expect(
      describeRecommendationFactors(
        explanation({
          topFactors: ['note density', 'chord complexity'],
          otherFactorCount: 4,
        }),
      ),
    ).toBe(
      'Based on note density, chord complexity and 4 other factors we suggest intensity 3.',
    );
  });

  it('puts a comma between every named factor but the last conjunction', () => {
    expect(
      describeRecommendationFactors(
        explanation({
          topFactors: ['note density', 'chord complexity', 'fret changes'],
          otherFactorCount: 2,
        }),
      ),
    ).toBe(
      'Based on note density, chord complexity, fret changes and 2 other factors we suggest intensity 3.',
    );
  });

  it('says "1 other factor", singular', () => {
    expect(
      describeRecommendationFactors(
        explanation({topFactors: ['tom work'], otherFactorCount: 1}),
      ),
    ).toBe('Based on tom work and 1 other factor we suggest intensity 3.');
  });

  it('drops the "and N other" clause when nothing was left out', () => {
    expect(
      describeRecommendationFactors(
        explanation({
          topFactors: ['tom work', 'kit coverage'],
          otherFactorCount: 0,
        }),
      ),
    ).toBe('Based on tom work and kit coverage we suggest intensity 3.');
  });

  it('reads as a sentence with a single factor and nothing else', () => {
    expect(
      describeRecommendationFactors(
        explanation({topFactors: ['note density']}),
      ),
    ).toBe('Based on note density we suggest intensity 3.');
  });

  it('says nothing when there is nothing to explain', () => {
    expect(describeRecommendationFactors(null)).toBeNull();
    expect(describeRecommendationFactors(explanation({}))).toBeNull();
    expect(
      describeRecommendationFactors(
        explanation({topFactors: ['note density'], recommended: null}),
      ),
    ).toBeNull();
  });

  it('describes a real chart end to end', () => {
    const sentence = describeRecommendationFactors(
      explainRecommendation(fretChart('guitar', 200), 'guitar'),
    )!;
    expect(sentence).toMatch(
      /^Based on .+ and 5 other factors we suggest intensity \d\.$/,
    );
  });
});

// ---------------------------------------------------------------------------
// Drums, on the fixture the drum calculator already ships a golden test for
// ---------------------------------------------------------------------------

const DRUM_FIXTURE = path.join(
  __dirname,
  '..',
  '..',
  'drum-difficulty',
  '__fixtures__',
  'reduction-01',
);
const hasDrumFixture = existsSync(path.join(DRUM_FIXTURE, 'notes.mid'));

(hasDrumFixture ? describe : describe.skip)('drum explanation', () => {
  it('names all seven drum factors, ordered by contribution', () => {
    const doc = readChart(
      [
        {
          fileName: 'notes.mid',
          data: new Uint8Array(
            readFileSync(path.join(DRUM_FIXTURE, 'notes.mid')),
          ),
        },
        {
          fileName: 'song.ini',
          data: new Uint8Array(
            readFileSync(path.join(DRUM_FIXTURE, 'song.ini')),
          ),
        },
      ] as never,
      {pro_drums: true},
    );

    const explanation = explainRecommendation(doc.parsedChart, 'drums')!;
    expect(explanation.factors).toHaveLength(DRUM_CORE_FEATURES.length);
    expect(explanation.recommended).toBe(3);
    expect(explanation.topFactors).toHaveLength(2);
    expect(explanation.otherFactorCount).toBe(5);
    const magnitudes = explanation.factors.map(f => Math.abs(f.contribution));
    expect(magnitudes).toEqual([...magnitudes].sort((a, b) => b - a));
    // Dc is the mean of the seven z-scores, so the contributions sum to it.
    const total = explanation.factors.reduce(
      (sum, f) => sum + f.contribution,
      0,
    );
    expect(total).toBeCloseTo(-0.5306555720250321, 9);
  });
});
