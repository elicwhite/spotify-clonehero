import type {
  ChartDocument,
  NormalizedVocalPart,
  NormalizedVocalPhrase,
} from '../types';
import {
  addDrumNote,
  addSection,
  cloneDocFor,
  createEmptyChart,
  entityHandlers,
  listLyricTicks,
  listPhraseEndTicks,
  listPhraseStartTicks,
  moveLyric,
  movePhraseEnd,
  movePhraseStart,
  noteId,
} from '../index';
import {emptyTrackData} from './test-utils';

// ---------------------------------------------------------------------------
// Doc factories
// ---------------------------------------------------------------------------

function emptyChart(): ChartDocument {
  return {
    parsedChart: createEmptyChart({bpm: 120, resolution: 480}),
    assets: [],
  };
}

function chartWithDrumTrack(): ChartDocument {
  const doc = emptyChart();
  doc.parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  return doc;
}

function makePhrase(
  tick: number,
  length: number,
  lyricTicks: number[] = [],
): NormalizedVocalPhrase {
  return {
    tick,
    msTime: 0,
    length,
    msLength: 0,
    isPercussion: false,
    notes: lyricTicks.map(t => ({
      tick: t,
      msTime: 0,
      length: 60,
      msLength: 0,
      pitch: 60,
      type: 'pitched' as const,
    })),
    lyrics: lyricTicks.map(t => ({
      tick: t,
      msTime: 0,
      text: `s${t}`,
      flags: 0,
    })),
  };
}

function emptyVocalPart(
  notePhrases: NormalizedVocalPhrase[] = [],
): NormalizedVocalPart {
  return {
    notePhrases,
    staticLyricPhrases: [],
    starPowerSections: [],
    rangeShifts: [],
    lyricShifts: [],
    textEvents: [],
  };
}

function chartWithVocals(
  notePhrases: NormalizedVocalPhrase[],
): ChartDocument {
  const doc = emptyChart();
  doc.parsedChart.vocalTracks = {
    parts: {vocals: emptyVocalPart(notePhrases)},
    rangeShifts: [],
    lyricShifts: [],
  };
  return doc;
}

// ---------------------------------------------------------------------------
// Lyric helpers
// ---------------------------------------------------------------------------

describe('lyric helpers', () => {
  it('listLyricTicks returns all ticks across phrases', () => {
    const doc = chartWithVocals([
      makePhrase(0, 480, [0, 240]),
      makePhrase(960, 480, [960, 1200]),
    ]);
    expect(listLyricTicks(doc)).toEqual([0, 240, 960, 1200]);
  });

  it('moveLyric shifts a lyric within its phrase and keeps the paired note in sync', () => {
    const doc = chartWithVocals([makePhrase(0, 480, [120, 240])]);
    const final = moveLyric(doc, 240, 360);
    expect(final).toBe(360);
    const phrase = doc.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(phrase.lyrics.map(l => l.tick)).toEqual([120, 360]);
    expect(phrase.notes.map(n => n.tick)).toEqual([120, 360]);
  });

  it('moveLyric clamps to the phrase upper bound', () => {
    const doc = chartWithVocals([makePhrase(0, 480, [240])]);
    const final = moveLyric(doc, 240, 9999);
    expect(final).toBe(480);
  });

  it('moveLyric clamps to the phrase lower bound', () => {
    const doc = chartWithVocals([makePhrase(960, 480, [1200])]);
    const final = moveLyric(doc, 1200, 0);
    expect(final).toBe(960);
  });

  it('moveLyric is a no-op when oldTick is missing', () => {
    const doc = chartWithVocals([makePhrase(0, 480, [240])]);
    const final = moveLyric(doc, 999, 0);
    expect(final).toBe(999);
    expect(listLyricTicks(doc)).toEqual([240]);
  });
});

// ---------------------------------------------------------------------------
// Phrase helpers
// ---------------------------------------------------------------------------

describe('phrase helpers', () => {
  it('movePhraseStart shrinks the phrase from the left, end tick fixed', () => {
    const doc = chartWithVocals([makePhrase(0, 480)]);
    const final = movePhraseStart(doc, 0, 120);
    expect(final).toBe(120);
    const phrase = doc.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(phrase.tick).toBe(120);
    expect(phrase.length).toBe(360);
  });

  it('movePhraseStart clamps so the phrase keeps minimum length', () => {
    const doc = chartWithVocals([makePhrase(0, 480)]);
    const final = movePhraseStart(doc, 0, 1000);
    expect(final).toBe(479); // endTick (480) - 1
  });

  it('movePhraseStart cannot cross the previous phrase end', () => {
    const doc = chartWithVocals([
      makePhrase(0, 480),
      makePhrase(960, 480),
    ]);
    const final = movePhraseStart(doc, 960, 0);
    expect(final).toBe(480);
  });

  it('movePhraseEnd grows the phrase on the right', () => {
    const doc = chartWithVocals([makePhrase(0, 480)]);
    const final = movePhraseEnd(doc, 480, 720);
    expect(final).toBe(720);
    const phrase = doc.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(phrase.length).toBe(720);
  });

  it('movePhraseEnd cannot cross the next phrase start', () => {
    const doc = chartWithVocals([
      makePhrase(0, 480),
      makePhrase(960, 480),
    ]);
    const final = movePhraseEnd(doc, 480, 9999);
    expect(final).toBe(960);
  });

  it('movePhraseEnd clamps so the phrase keeps minimum length', () => {
    const doc = chartWithVocals([makePhrase(960, 480)]);
    const final = movePhraseEnd(doc, 1440, 0);
    expect(final).toBe(961);
  });
});

// ---------------------------------------------------------------------------
// Dispatch + cloning
// ---------------------------------------------------------------------------

describe('entityHandlers dispatch', () => {
  it('every kind round-trips listIds → locate without nulls', () => {
    const doc = chartWithDrumTrack();
    const drums = doc.parsedChart.trackData[0];
    addDrumNote(drums, {tick: 0, type: 'kick'});
    addDrumNote(drums, {tick: 480, type: 'redDrum'});
    addSection(doc, 1920, 'Verse');
    doc.parsedChart.vocalTracks = {
      parts: {vocals: emptyVocalPart([makePhrase(0, 480, [120, 360])])},
      rangeShifts: [],
      lyricShifts: [],
    };

    for (const kind of [
      'note',
      'section',
      'lyric',
      'phrase-start',
      'phrase-end',
    ] as const) {
      const handler = entityHandlers[kind];
      const ids = handler.listIds(doc);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(handler.locate(doc, id)).not.toBeNull();
      }
    }
  });

  it('note handler shifts both tick and lane', () => {
    const doc = chartWithDrumTrack();
    addDrumNote(doc.parsedChart.trackData[0], {tick: 480, type: 'redDrum'});

    const cloned = cloneDocFor('note', doc);
    const newId = entityHandlers.note.move(
      cloned,
      noteId({tick: 480, type: 'redDrum'}),
      240,
      1,
    );
    expect(newId).toBe(noteId({tick: 720, type: 'yellowDrum'}));
    // Original untouched
    expect(doc.parsedChart.trackData[0].noteEventGroups[0][0].tick).toBe(480);
  });

  it('section handler returns the new id when the tick changes', () => {
    const doc = emptyChart();
    addSection(doc, 1920, 'Verse');
    const cloned = cloneDocFor('section', doc);
    const newId = entityHandlers.section.move(cloned, '1920', -240, 0);
    expect(newId).toBe('1680');
    expect(cloned.parsedChart.sections.map(s => s.tick)).toEqual([1680]);
    expect(doc.parsedChart.sections.map(s => s.tick)).toEqual([1920]);
  });

  it('lyric handler returns clamped id when drag overshoots phrase', () => {
    const doc = chartWithVocals([makePhrase(0, 480, [240])]);
    const cloned = cloneDocFor('lyric', doc);
    const newId = entityHandlers.lyric.move(cloned, '240', 9999, 0);
    expect(newId).toBe('480');
  });

  it('phrase-start handler returns same id when fully clamped', () => {
    const doc = chartWithVocals([
      makePhrase(0, 480),
      makePhrase(960, 480),
    ]);
    const cloned = cloneDocFor('phrase-start', doc);
    const newId = entityHandlers['phrase-start'].move(cloned, '960', -1000, 0);
    expect(newId).toBe('480');
  });

  it('phrase-end handler returns same id when fully clamped against next phrase', () => {
    const doc = chartWithVocals([
      makePhrase(0, 480),
      makePhrase(960, 480),
    ]);
    const cloned = cloneDocFor('phrase-end', doc);
    const newId = entityHandlers['phrase-end'].move(cloned, '480', 9999, 0);
    expect(newId).toBe('960');
  });
});

// ---------------------------------------------------------------------------
// listPhraseStartTicks / listPhraseEndTicks
// ---------------------------------------------------------------------------

describe('phrase listing helpers', () => {
  it('start + end ticks line up phrase by phrase', () => {
    const doc = chartWithVocals([
      makePhrase(0, 480),
      makePhrase(960, 240),
    ]);
    expect(listPhraseStartTicks(doc)).toEqual([0, 960]);
    expect(listPhraseEndTicks(doc)).toEqual([480, 1200]);
  });
});
