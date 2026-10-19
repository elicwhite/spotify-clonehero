import {describe, test, expect} from '@jest/globals';
import {parseChartAndIni, scanChart} from '@eliwhite/scan-chart';
import {createEmptyChart, writeChartFolder} from '@/lib/chart-edit';
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

  test('a phrase carries its lyrics and no notes', () => {
    const doc = makeDoc();
    const syllables = [syl('hello', 500, false, true, 600)];

    const result = applyAlignedLyricsToDoc(doc, syllables);
    const vocals = result.parsedChart.vocalTracks.parts['vocals'];

    expect(vocals.notePhrases).toHaveLength(1);
    const phrase = vocals.notePhrases[0];
    expect(phrase.lyrics.map(l => l.text)).toEqual(['hello']);
    expect(phrase.notes).toEqual([]);
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

  // The chart declares lyrics, not a vocals part. Community charts do the
  // same: across a 1,471-chart sample of lyric-bearing .chart files, the
  // total vocal-note count is zero. A fabricated note is not inert either —
  // the .mid writer emits it for real, so it would reach YARG as a playable
  // monotone C4 vocal line over the whole song.
  test('writes no vocal notes', () => {
    const result = applyAlignedLyricsToDoc(makeDoc(), [
      syl('hel', 500, true, true, 600),
      syl('lo', 700, false, false, 800),
    ]);
    const vocals = result.parsedChart.vocalTracks.parts['vocals'];
    expect(vocals.notePhrases.flatMap(p => p.notes)).toEqual([]);
    expect(vocals.notePhrases.flatMap(p => p.lyrics)).not.toEqual([]);
  });

  // The notes used to exist because they were believed necessary to keep the
  // lyric across a serialize/reparse. They are not, in either format.
  describe.each(['chart', 'mid'] as const)('round trip as .%s', format => {
    test('keeps every lyric with no vocal notes', () => {
      const source: ChartDocument = {
        parsedChart: createEmptyChart({format, resolution: RES, bpm: 120}),
        assets: [],
      };
      const applied = applyAlignedLyricsToDoc(source, [
        syl('hel', 500, true, true, 600),
        syl('lo', 700, false, false, 800),
        syl('world', 2000, false, true, 2100),
      ]);
      applied.parsedChart.metadata = {
        ...applied.parsedChart.metadata,
        name: 'Song',
        artist: 'Artist',
        charter: 'Charter',
      };

      const files = writeChartFolder(applied);
      const reparsed = parseChartAndIni(files);
      const parts = reparsed.parsedChart?.vocalTracks?.parts ?? {};
      const phrases = Object.values(parts).flatMap(p => p.notePhrases);

      expect(phrases.flatMap(p => p.lyrics.map(l => l.text))).toEqual([
        'hel-',
        'lo',
        'world',
      ]);
      expect(phrases.flatMap(p => p.notes)).toEqual([]);

      // What YARG would be told: lyrics present, no playable vocals.
      const scanned = scanChart(files, reparsed, {
        includeMd5: false,
        includeBTrack: false,
      });
      expect(scanned.notesData?.hasLyrics).toBe(true);
    });
  });
});
