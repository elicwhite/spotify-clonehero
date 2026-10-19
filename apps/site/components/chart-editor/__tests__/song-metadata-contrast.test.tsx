/**
 * @jest-environment jsdom
 */
/**
 * Contrast pin for the metadata dialog's difficulty suggestion chip.
 *
 * The chip sits on `--background` — near-white in light mode — and its tones
 * were originally written for a dark surface only (`text-red-200`,
 * `text-amber-200`), which read as pale text on white. Every tone the chip
 * can take now has to clear 4.5:1 in BOTH themes.
 *
 * Measured from the compiled stylesheet rather than from a class list; see
 * `tailwindContrast.ts` for why.
 */

import {render, screen} from '@testing-library/react';
import type {DifficultyRecommendationState} from '@/lib/chart-difficulty/recommendationState';

import {DifficultyRow} from '../SongMetadataFields';
import {compile, contrast, textColor, themeColor} from './tailwindContrast';

function recommendation(
  overrides: Partial<DifficultyRecommendationState> = {},
): DifficultyRecommendationState {
  return {
    status: 'disagrees',
    stored: 1,
    recommended: 5,
    delta: 4,
    severity: 'major',
    chartChangedSinceSet: false,
    canApply: true,
    ...overrides,
  };
}

/** The classes the chip actually renders with, for a given state. */
function chipClasses(state: DifficultyRecommendationState): string[] {
  const {unmount} = render(
    <DifficultyRow
      id="drums"
      label="Drums"
      value={state.stored}
      onChange={() => {}}
      suggestion={{state, explanation: null, onApply: () => {}}}
    />,
  );
  const classes = Array.from(screen.getByRole('button').classList);
  unmount();
  return classes;
}

/** Every tone the chip can take, named by the text utility it emits. */
const TONES = [
  {
    name: 'major disagreement',
    state: recommendation({severity: 'major'}),
    light: '.text-red-800',
    dark: '.dark:text-red-200',
  },
  {
    name: 'moderate disagreement',
    state: recommendation({severity: 'moderate', delta: 2, recommended: 3}),
    light: '.text-amber-800',
    dark: '.dark:text-amber-200',
  },
  {
    name: 'stale (chart changed since the value was set)',
    state: recommendation({status: 'stale', chartChangedSinceSet: true}),
    light: '.text-amber-800',
    dark: '.dark:text-amber-200',
  },
];

describe('difficulty suggestion chip', () => {
  it.each(TONES)(
    'clears 4.5:1 on the dialog background in both themes — $name',
    async ({state, light, dark}) => {
      const root = await compile(chipClasses(state));
      for (const [theme, selector] of [
        ['light', light],
        ['dark', dark],
      ] as const) {
        expect(
          contrast(
            textColor(root, selector, theme),
            themeColor(root, '--background', theme),
          ),
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('would fail with the dark-only tone, which is why both themes are spelled', async () => {
    // The regression this pins, as a measurement: `text-red-200` on the
    // light `--background` is about 1.3:1.
    const root = await compile(['text-red-200']);
    expect(
      contrast(
        textColor(root, '.text-red-200', 'light'),
        themeColor(root, '--background', 'light'),
      ),
    ).toBeLessThan(2);
  });
});
