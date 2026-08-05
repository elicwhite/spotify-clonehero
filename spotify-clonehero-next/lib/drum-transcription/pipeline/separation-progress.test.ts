/**
 * The 'separating' step's progress is one monotonic 0-1 sweep, whatever
 * sub-step separation is reporting.
 */

import type {DrumSeparationProgress} from '@/lib/audio-pipeline/separate-stems';
import {separationProgressToFraction} from './separation-progress';

const SWEEP: DrumSeparationProgress[] = [
  {step: 'loading-model', percent: 0},
  {step: 'loading-model', percent: 1},
  {step: 'processing', percent: 0},
  {step: 'processing', percent: 0.5},
  {step: 'processing', percent: 1},
  {step: 'storing', percent: 0},
  {step: 'storing', percent: 1},
  {step: 'done', percent: 1},
];

describe('separationProgressToFraction', () => {
  it('never moves backwards across a whole separation', () => {
    const fractions = SWEEP.map(separationProgressToFraction);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    }
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
  });

  it('clamps a sub-step percent outside 0-1 to its own range', () => {
    expect(
      separationProgressToFraction({step: 'processing', percent: -1}),
    ).toBe(0.15);
    expect(separationProgressToFraction({step: 'processing', percent: 9})).toBe(
      0.97,
    );
  });
});
