/**
 * @jest-environment jsdom
 */
/**
 * Stems mixer row glyphs (plan 0076 item 9): a row that names an instrument
 * shows that instrument's PNG, the same art the Chart Matrix and the assist
 * cards use, instead of a generic waveform.
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';

import StemsMixer from '../StemsMixer';
import {CLICK_TRACK_NAME} from '@/lib/preview/clickTrack';
import type {AudioManager} from '@/lib/preview/audioManager';

beforeAll(() => {
  // Radix's Slider primitive (inside every mixer row) observes its track.
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function stubAudioManager(trackNames: string[]): AudioManager {
  return {
    trackNames,
    setVolume: () => {},
    getVolume: () => 1,
  } as unknown as AudioManager;
}

/** The `src` of the image inside a given stem row, or null when the row
 *  draws a vector glyph instead. */
function rowImageSrc(name: string): string | null {
  const row = screen.getByTestId(`stem-row-${name}`);
  return row.querySelector('img')?.getAttribute('src') ?? null;
}

describe('StemsMixer row icons', () => {
  it('gives each instrument row its own instrument art', () => {
    render(
      <StemsMixer
        audioManager={stubAudioManager([
          'song',
          'drums',
          'guitar',
          'bass',
          'vocals',
          CLICK_TRACK_NAME,
        ])}
      />,
    );

    expect(rowImageSrc('drums')).toContain('drums.png');
    expect(rowImageSrc('guitar')).toContain('guitar.png');
    expect(rowImageSrc('bass')).toContain('bass.png');
    expect(rowImageSrc('vocals')).toContain('vocals.png');
  });

  it('leaves rows that name no instrument on the generic glyph', () => {
    render(
      <StemsMixer
        audioManager={stubAudioManager(['song', 'rhythm', CLICK_TRACK_NAME])}
      />,
    );

    expect(rowImageSrc('song')).toBeNull();
    expect(rowImageSrc('rhythm')).toBeNull();
    expect(rowImageSrc(CLICK_TRACK_NAME)).toBeNull();
  });
});
