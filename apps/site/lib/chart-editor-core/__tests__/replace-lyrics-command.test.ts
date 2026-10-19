/**
 * ReplaceLyricsCommand + hasExistingLyrics tests (plan 0063 Part C).
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import {ReplaceLyricsCommand, hasExistingLyrics} from '../commands';
import {makeEmptyDrumDoc, makeFixtureDoc} from './fixtures';
import type {AlignedSyllable} from '@/lib/lyrics-align/aligner';

function syl(
  text: string,
  startMs: number,
  joinNext = false,
  newLine = false,
  endMs?: number,
): AlignedSyllable {
  return {text, startMs, endMs: endMs ?? startMs + 100, joinNext, newLine};
}

describe('ReplaceLyricsCommand', () => {
  it('execute replaces the vocals part with the new aligned syllables', () => {
    const before = makeFixtureDoc();
    const syllables = [
      syl('new', 500, false, true),
      syl('lyrics', 1500, false, true),
    ];

    const cmd = new ReplaceLyricsCommand(syllables);
    const after = cmd.execute(before);

    expect(after).not.toBe(before);
    const vocals = after.parsedChart.vocalTracks.parts['vocals'];
    expect(vocals.notePhrases.flatMap(p => p.lyrics.map(l => l.text))).toEqual([
      'new',
      'lyrics',
    ]);
    // staticLyricPhrases is cleared so scan-chart's writer doesn't union it
    // with the new notePhrases (see apply-lyrics.ts).
    expect(vocals.staticLyricPhrases).toEqual([]);
  });

  it('does not mutate the input doc', () => {
    const before = makeFixtureDoc();
    const originalVocals = before.parsedChart.vocalTracks;
    const cmd = new ReplaceLyricsCommand([syl('x', 0, false, true)]);
    cmd.execute(before);
    expect(before.parsedChart.vocalTracks).toBe(originalVocals);
  });

  it('adds a vocals part to a doc with no prior vocals part', () => {
    const before = makeEmptyDrumDoc();
    const cmd = new ReplaceLyricsCommand([syl('solo', 0, false, true)]);
    const after = cmd.execute(before);

    expect(
      after.parsedChart.vocalTracks.parts['vocals'].notePhrases,
    ).toHaveLength(1);
    expect(before.parsedChart.vocalTracks?.parts['vocals']).toBeUndefined();
  });
});

describe('hasExistingLyrics', () => {
  it('is true for a doc whose vocals part already has notePhrase lyrics', () => {
    const doc = makeFixtureDoc();
    expect(hasExistingLyrics(doc.parsedChart.vocalTracks)).toBe(true);
  });

  it('is false for a doc with no vocal tracks at all', () => {
    const doc = makeEmptyDrumDoc();
    expect(hasExistingLyrics(doc.parsedChart.vocalTracks)).toBe(false);
  });

  it('is false for a vocals part with phrases but no lyrics', () => {
    const parsed = createEmptyChart({bpm: 120, resolution: 480});
    parsed.vocalTracks = {
      parts: {
        vocals: {
          notePhrases: [
            {
              tick: 0,
              msTime: 0,
              length: 480,
              msLength: 250,
              isPercussion: false,
              notes: [],
              lyrics: [],
            },
          ],
          staticLyricPhrases: [],
          starPowerSections: [],
          rangeShifts: [],
          lyricShifts: [],
          textEvents: [],
        },
      },
      rangeShifts: [],
      lyricShifts: [],
    };
    expect(hasExistingLyrics(parsed.vocalTracks)).toBe(false);
  });

  it('is true when only staticLyricPhrases carries lyrics', () => {
    const parsed = createEmptyChart({bpm: 120, resolution: 480});
    parsed.vocalTracks = {
      parts: {
        vocals: {
          notePhrases: [],
          staticLyricPhrases: [
            {
              tick: 0,
              msTime: 0,
              length: 480,
              msLength: 250,
              isPercussion: false,
              notes: [],
              lyrics: [{tick: 0, msTime: 0, text: 'hi', flags: 0}],
            },
          ],
          starPowerSections: [],
          rangeShifts: [],
          lyricShifts: [],
          textEvents: [],
        },
      },
      rangeShifts: [],
      lyricShifts: [],
    };
    expect(hasExistingLyrics(parsed.vocalTracks)).toBe(true);
  });
});
