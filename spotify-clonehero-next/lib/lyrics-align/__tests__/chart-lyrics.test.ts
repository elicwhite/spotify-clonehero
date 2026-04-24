import {describe, test, expect} from '@jest/globals';
import {alignedSyllablesToChartLyrics} from '../chart-lyrics';
import type {AlignedSyllable} from '../aligner';

const TEMPOS = [{tick: 0, beatsPerMinute: 120}];
const RES = 480;

function syl(
  text: string,
  startMs: number,
  joinNext = false,
  newLine = false,
): AlignedSyllable {
  return {text, startMs, joinNext, newLine};
}

describe('alignedSyllablesToChartLyrics', () => {
  test('single word produces one lyric and one phrase', () => {
    const result = alignedSyllablesToChartLyrics(
      [syl('hello', 500, false, true)],
      TEMPOS,
      RES,
    );

    expect(result.lyrics).toHaveLength(1);
    expect(result.lyrics[0].text).toBe('hello');
    expect(result.lyrics[0].tick).toBe(480); // 500ms at 120 BPM / 480 ppq
    expect(result.lyrics[0].length).toBe(0);
    expect(result.vocalPhrases).toHaveLength(1);
  });

  test('multi-syllable word has hyphen suffixes', () => {
    const result = alignedSyllablesToChartLyrics(
      [syl('ev', 500, true, true), syl('ery', 700, false, false)],
      TEMPOS,
      RES,
    );

    expect(result.lyrics).toHaveLength(2);
    expect(result.lyrics[0].text).toBe('ev-');
    expect(result.lyrics[1].text).toBe('ery');
  });

  test('multiple words have no hyphen suffix', () => {
    const result = alignedSyllablesToChartLyrics(
      [syl('hello', 500, false, true), syl('world', 1000, false, false)],
      TEMPOS,
      RES,
    );

    expect(result.lyrics[0].text).toBe('hello');
    expect(result.lyrics[1].text).toBe('world');
  });

  test('literal hyphen in text is escaped to =', () => {
    const result = alignedSyllablesToChartLyrics(
      [syl('well-known', 500, false, true)],
      TEMPOS,
      RES,
    );

    expect(result.lyrics[0].text).toBe('well=known');
  });

  test('newLine markers create separate phrases', () => {
    const result = alignedSyllablesToChartLyrics(
      [
        syl('line', 500, false, true),
        syl('one', 700, false, false),
        syl('line', 2000, false, true), // new line
        syl('two', 2500, false, false),
      ],
      TEMPOS,
      RES,
    );

    expect(result.vocalPhrases).toHaveLength(2);
    expect(result.vocalPhrases[0].tick).toBe(480); // 500ms
    expect(result.vocalPhrases[1].tick).toBe(1920); // 2000ms
  });

  test('phrase length spans from first to last syllable', () => {
    // At 120 BPM / 480 ppq: 500ms = tick 480, 1500ms = tick 1440
    const result = alignedSyllablesToChartLyrics(
      [
        syl('a', 500, false, true),
        syl('b', 1000, false, false),
        syl('c', 1500, false, false),
      ],
      TEMPOS,
      RES,
    );

    expect(result.vocalPhrases).toHaveLength(1);
    expect(result.vocalPhrases[0].tick).toBe(480);
    expect(result.vocalPhrases[0].length).toBe(1440 - 480); // 960
  });

  test('single-syllable phrase has minimum length of resolution', () => {
    const result = alignedSyllablesToChartLyrics(
      [syl('hi', 500, false, true)],
      TEMPOS,
      RES,
    );

    // length = max(0, resolution) = 480
    expect(result.vocalPhrases[0].length).toBe(480);
  });

  test('empty input returns empty arrays', () => {
    const result = alignedSyllablesToChartLyrics([], TEMPOS, RES);
    expect(result.lyrics).toEqual([]);
    expect(result.vocalPhrases).toEqual([]);
  });

  test('tempo change affects tick positions', () => {
    // 120 BPM for first 960 ticks (1000ms), then 240 BPM
    const tempos = [
      {tick: 0, beatsPerMinute: 120},
      {tick: 960, beatsPerMinute: 240},
    ];

    const result = alignedSyllablesToChartLyrics(
      [
        syl('before', 500, false, true),
        syl('after', 1250, false, true), // 250ms into 240 BPM section
      ],
      tempos,
      RES,
    );

    expect(result.lyrics[0].tick).toBe(480); // 500ms at 120 BPM
    // 1250ms = 1000ms + 250ms at 240 BPM: 960 + (250 * 240 * 480 / 60000) = 960 + 480 = 1440
    expect(result.lyrics[1].tick).toBe(1440);
  });
});
