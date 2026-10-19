import {describe, test, expect} from '@jest/globals';
import {createEmptyChart} from '@/lib/chart-edit';
import type {ChartDocument, NormalizedVocalPart} from '@/lib/chart-edit';
import {
  addLyric,
  deleteLyric,
  hasAnyLyrics,
  restoreLyric,
  setLyricText,
  lyricId,
} from '../lyrics';

const RES = 480;

function emptyPart(): NormalizedVocalPart {
  return {
    notePhrases: [],
    staticLyricPhrases: [],
    starPowerSections: [],
    rangeShifts: [],
    lyricShifts: [],
    textEvents: [],
  } as unknown as NormalizedVocalPart;
}

function makeDoc(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    resolution: RES,
    bpm: 120,
  });
  parsedChart.vocalTracks.parts['vocals'] = emptyPart();
  return {parsedChart, assets: []};
}

function addPhrase(doc: ChartDocument, tick: number, length: number) {
  const part = doc.parsedChart.vocalTracks.parts['vocals'];
  part.notePhrases.push({
    tick,
    msTime: 0,
    length,
    msLength: 0,
    isPercussion: false,
    notes: [],
    lyrics: [],
  });
}

describe('addLyric', () => {
  test('adds a lyric, and no vocal note, inside the containing phrase', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);

    const id = addLyric(doc, 480, 'hel-');
    const phrase = doc.parsedChart.vocalTracks.parts['vocals'].notePhrases[0];

    expect(id).toBe(lyricId(480));
    expect(phrase.lyrics).toHaveLength(1);
    expect(phrase.lyrics[0]).toMatchObject({tick: 480, text: 'hel-'});
    // A lyric is display text. Declaring a pitched note here would advertise
    // a playable vocals part nobody charted — see applyAlignedLyricsToDoc.
    expect(phrase.notes).toEqual([]);
  });

  test('returns null when no phrase contains the tick', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 480);

    expect(addLyric(doc, 2000, 'lo')).toBeNull();
  });

  test('returns null when a lyric already exists at that tick', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);
    addLyric(doc, 480, 'hel-');

    expect(addLyric(doc, 480, 'again')).toBeNull();
    expect(
      doc.parsedChart.vocalTracks.parts['vocals'].notePhrases[0].lyrics,
    ).toHaveLength(1);
  });

  test('adds a lyric that lands near the phrase end', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 500);

    expect(addLyric(doc, 470, 'end')).toBe(lyricId(470));
    const phrase = doc.parsedChart.vocalTracks.parts['vocals'].notePhrases[0];
    expect(phrase.lyrics.map(l => l.tick)).toEqual([470]);
  });
});

describe('deleteLyric', () => {
  test('removes the lyric, keeping the phrase when others remain', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);
    addLyric(doc, 0, 'hel-');
    addLyric(doc, 480, 'lo');

    const removed = deleteLyric(doc, 0);
    const phrase = doc.parsedChart.vocalTracks.parts['vocals'].notePhrases[0];

    expect(removed?.phraseDeleted).toBe(false);
    expect(phrase.lyrics.map(l => l.tick)).toEqual([480]);
  });

  // This editor writes no vocal notes, but an imported chart with real
  // vocals has them, and deleting a lyric must take its note with it.
  test('removes a vocal note the imported chart paired with the lyric', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);
    addLyric(doc, 0, 'hel-');
    addLyric(doc, 480, 'lo');
    const phrase = doc.parsedChart.vocalTracks.parts['vocals'].notePhrases[0];
    for (const tick of [0, 480]) {
      phrase.notes.push({
        tick,
        msTime: 0,
        length: 60,
        msLength: 0,
        pitch: 62,
        type: 'pitched',
      });
    }

    const removed = deleteLyric(doc, 0);

    expect(removed?.note).toMatchObject({tick: 0, pitch: 62});
    expect(phrase.notes.map(n => n.tick)).toEqual([480]);
  });

  test('deletes the now-empty phrase when its last lyric is removed', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);
    addLyric(doc, 0, 'only');

    const removed = deleteLyric(doc, 0);

    expect(removed?.phraseDeleted).toBe(true);
    expect(
      doc.parsedChart.vocalTracks.parts['vocals'].notePhrases,
    ).toHaveLength(0);
  });

  test('returns null when no lyric exists at the tick', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);

    expect(deleteLyric(doc, 480)).toBeNull();
  });
});

describe('restoreLyric', () => {
  test('undoes a lyric-only delete by re-inserting into the surviving phrase', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);
    addLyric(doc, 0, 'hel-');
    addLyric(doc, 480, 'lo');

    const removed = deleteLyric(doc, 0)!;
    restoreLyric(doc, removed, 0);

    const phrase = doc.parsedChart.vocalTracks.parts['vocals'].notePhrases[0];
    expect(phrase.lyrics.map(l => l.tick)).toEqual([0, 480]);
    expect(phrase.notes).toEqual([]);
  });

  test('undoes a phrase-emptying delete by restoring the whole phrase', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);
    addLyric(doc, 0, 'only');

    const removed = deleteLyric(doc, 0)!;
    restoreLyric(doc, removed, 0);

    const phrases = doc.parsedChart.vocalTracks.parts['vocals'].notePhrases;
    expect(phrases).toHaveLength(1);
    expect(phrases[0].lyrics.map(l => l.tick)).toEqual([0]);
  });
});

describe('setLyricText', () => {
  test('replaces the text of the lyric at tick', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);
    addLyric(doc, 0, 'old');

    expect(setLyricText(doc, 0, 'new')).toBe(true);
    expect(
      doc.parsedChart.vocalTracks.parts['vocals'].notePhrases[0].lyrics[0].text,
    ).toBe('new');
  });

  test('returns false when no lyric exists at tick', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, 960);

    expect(setLyricText(doc, 480, 'new')).toBe(false);
  });
});

describe('hasAnyLyrics', () => {
  test('is false for a chart with no vocal track at all', () => {
    const parsedChart = createEmptyChart({
      format: 'chart',
      resolution: RES,
      bpm: 120,
    });
    expect(hasAnyLyrics({parsedChart, assets: []})).toBe(false);
  });

  test('is false for a vocal part with phrases but no lyrics', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, RES);
    expect(hasAnyLyrics(doc)).toBe(false);
  });

  test('is true once a part carries one lyric', () => {
    const doc = makeDoc();
    addPhrase(doc, 0, RES);
    expect(addLyric(doc, 0, 'la')).not.toBeNull();
    expect(hasAnyLyrics(doc)).toBe(true);
  });
});
