import {describe, test, expect} from '@jest/globals';
import {createEmptyChart} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {applyAlignedLyricsToDoc} from '../apply-lyrics';
import type {AlignedSyllable} from '../aligner';

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

function makeDoc(): ChartDocument {
  return {
    parsedChart: createEmptyChart({format: 'chart', resolution: RES, bpm: 120}),
    assets: [],
  };
}

describe('applyAlignedLyricsToDoc', () => {
  test('groups syllables into phrases by newLine marker', () => {
    const doc = makeDoc();
    const syllables = [
      syl('hel', 500, true, true, 600),
      syl('lo', 700, false, false, 800),
      syl('world', 2000, false, true, 2100),
    ];

    const result = applyAlignedLyricsToDoc(doc, syllables);
    const vocals = result.parsedChart.vocalTracks.parts['vocals'];

    expect(vocals.notePhrases).toHaveLength(2);
    expect(vocals.notePhrases[0].lyrics.map(l => l.text)).toEqual([
      'hel-',
      'lo',
    ]);
    expect(vocals.notePhrases[1].lyrics.map(l => l.text)).toEqual(['world']);
  });

  test('each lyric gets a placeholder pitched note', () => {
    const doc = makeDoc();
    const syllables = [syl('hello', 500, false, true, 600)];

    const result = applyAlignedLyricsToDoc(doc, syllables);
    const vocals = result.parsedChart.vocalTracks.parts['vocals'];

    expect(vocals.notePhrases).toHaveLength(1);
    const phrase = vocals.notePhrases[0];
    expect(phrase.notes).toHaveLength(1);
    expect(phrase.notes[0]).toMatchObject({
      tick: phrase.lyrics[0].tick,
      pitch: 60,
      type: 'pitched',
    });
    expect(phrase.isPercussion).toBe(false);
  });

  test('clears staticLyricPhrases on the vocals part so writers do not duplicate lyrics', () => {
    const doc = makeDoc();
    doc.parsedChart.vocalTracks.parts['vocals'] = {
      notePhrases: [],
      staticLyricPhrases: [{tick: 0, length: 100, lyric: 'old'}] as never,
      starPowerSections: [],
      rangeShifts: [],
      lyricShifts: [],
      textEvents: [],
    } as never;

    const syllables = [syl('new', 500, false, true, 600)];
    const result = applyAlignedLyricsToDoc(doc, syllables);
    const vocals = result.parsedChart.vocalTracks.parts['vocals'];

    expect(vocals.staticLyricPhrases).toEqual([]);
    expect(vocals.notePhrases[0].lyrics[0].text).toBe('new');
  });

  test('empty syllables produce an empty vocals part with no phrases', () => {
    const doc = makeDoc();
    const result = applyAlignedLyricsToDoc(doc, []);
    const vocals = result.parsedChart.vocalTracks.parts['vocals'];

    expect(vocals.notePhrases).toEqual([]);
    expect(vocals.staticLyricPhrases).toEqual([]);
  });
});
