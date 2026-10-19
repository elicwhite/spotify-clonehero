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
  endMs?: number,
): AlignedSyllable {
  return {text, startMs, endMs: endMs ?? startMs, joinNext, newLine};
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
        syl('line', 500, false, true, 600),
        syl('one', 700, false, false, 800),
        syl('line', 2000, false, true, 2100), // new line
        syl('two', 2500, false, false, 2600),
      ],
      TEMPOS,
      RES,
    );

    expect(result.vocalPhrases).toHaveLength(2);
    // Phrase 0 first phrase: backwardGap=500 → preroll=min(240, 275)=240.
    //   start = 500 - 240 = 260ms → tick 250
    expect(result.vocalPhrases[0].tick).toBe(250);
    // Phrase 1 backwardGap = 2000-800 = 1200 → preroll=240.
    //   start = 2000 - 240 = 1760ms → tick 1690
    expect(result.vocalPhrases[1].tick).toBe(1690);
  });

  test('phrase end uses syllable endMs and extends by postroll', () => {
    // Single phrase: a@[500,600], b@[1000,1100], c@[1500,1600] at 120 BPM/480 ppq.
    // firstOnset=500, lastEnd=1600. Sole phrase: backwardGap=500 → preroll=240.
    //   forwardGap=Inf → postroll=180.
    //   start = 500-240 = 260ms → tick 250
    //   end = 1600+180 = 1780ms → tick round(1780*120*480/60000) = round(1708.8) = 1709
    //   length = 1709 - 250 = 1459
    const result = alignedSyllablesToChartLyrics(
      [
        syl('a', 500, false, true, 600),
        syl('b', 1000, false, false, 1100),
        syl('c', 1500, false, false, 1600),
      ],
      TEMPOS,
      RES,
    );

    expect(result.vocalPhrases).toHaveLength(1);
    expect(result.vocalPhrases[0].tick).toBe(250);
    expect(result.vocalPhrases[0].length).toBe(1459);
  });

  test('tight gap caps preroll and postroll so phrases do not overlap', () => {
    // gap = 100ms between phrase 0 end (700) and phrase 1 start (800).
    //   preroll cap = 100*0.55 = 55ms
    //   postroll cap = 100*0.25 = 25ms
    //   55 + 25 = 80ms <= 100ms gap, so phrases stay non-overlapping.
    const result = alignedSyllablesToChartLyrics(
      [syl('a', 500, false, true, 700), syl('b', 800, false, true, 1000)],
      TEMPOS,
      RES,
    );

    expect(result.vocalPhrases).toHaveLength(2);
    const p0End = result.vocalPhrases[0].tick + result.vocalPhrases[0].length;
    const p1Start = result.vocalPhrases[1].tick;
    expect(p0End).toBeLessThanOrEqual(p1Start);
  });

  test('single-syllable phrase length covers preroll + postroll', () => {
    // syl('hi', 500) with endMs=500.
    // First (and only) phrase: backwardGap=500 → preroll=240; forwardGap=Inf → postroll=180.
    //   start = 500-240 = 260ms → tick 250
    //   end = 500+180 = 680ms → tick round(652.8) = 653
    //   length = 653-250 = 403
    const result = alignedSyllablesToChartLyrics(
      [syl('hi', 500, false, true)],
      TEMPOS,
      RES,
    );

    expect(result.vocalPhrases[0].tick).toBe(250);
    expect(result.vocalPhrases[0].length).toBe(403);
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
