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
  getDrumNotes,
  listLyricTicks,
  listPhraseEndTicks,
  listPhraseStartTicks,
  guitarSchema,
  moveLyric,
  movePhraseEnd,
  movePhraseStart,
  noteId,
} from '../index';
import {addNote} from '../entities/notes';
import {emptyTrackData} from './test-utils';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';

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

function chartWithGuitarTrack(): ChartDocument {
  const doc = emptyChart();
  doc.parsedChart.trackData.push(emptyTrackData('guitar', 'expert'));
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

function chartWithVocals(notePhrases: NormalizedVocalPhrase[]): ChartDocument {
  const doc = emptyChart();
  doc.parsedChart.vocalTracks = {
    parts: {vocals: emptyVocalPart(notePhrases)},
    rangeShifts: [],
    lyricShifts: [],
  };
  return doc;
}

function chartWithMultiPartVocals(
  partNamesToPhrases: Record<string, NormalizedVocalPhrase[]>,
): ChartDocument {
  const doc = emptyChart();
  const parts: Record<string, NormalizedVocalPart> = {};
  for (const [name, phrases] of Object.entries(partNamesToPhrases)) {
    parts[name] = emptyVocalPart(phrases);
  }
  doc.parsedChart.vocalTracks = {parts, rangeShifts: [], lyricShifts: []};
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
    const phrase = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0];
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
    const phrase = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0];
    expect(phrase.tick).toBe(120);
    expect(phrase.length).toBe(360);
  });

  it('movePhraseStart clamps so the phrase keeps minimum length', () => {
    const doc = chartWithVocals([makePhrase(0, 480)]);
    const final = movePhraseStart(doc, 0, 1000);
    expect(final).toBe(479); // endTick (480) - 1
  });

  it('movePhraseStart cannot cross the previous phrase end', () => {
    const doc = chartWithVocals([makePhrase(0, 480), makePhrase(960, 480)]);
    const final = movePhraseStart(doc, 960, 0);
    expect(final).toBe(480);
  });

  it('movePhraseEnd grows the phrase on the right', () => {
    const doc = chartWithVocals([makePhrase(0, 480)]);
    const final = movePhraseEnd(doc, 480, 720);
    expect(final).toBe(720);
    const phrase = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0];
    expect(phrase.length).toBe(720);
  });

  it('movePhraseEnd cannot cross the next phrase start', () => {
    const doc = chartWithVocals([makePhrase(0, 480), makePhrase(960, 480)]);
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
    addDrumNote(drums, {tick: 0, type: noteTypes.kick});
    addDrumNote(drums, {tick: 480, type: noteTypes.redDrum});
    addSection(doc, 1920, 'Verse');
    doc.parsedChart.vocalTracks = {
      parts: {vocals: emptyVocalPart([makePhrase(0, 480, [120, 360])])},
      rangeShifts: [],
      lyricShifts: [],
    };

    const drumsCtx = {
      trackKey: {instrument: 'drums', difficulty: 'expert'},
    } as const;
    for (const kind of [
      'note',
      'section',
      'lyric',
      'phrase-start',
      'phrase-end',
    ] as const) {
      const handler = entityHandlers[kind];
      // Note kind requires a trackKey; chart-wide and vocal kinds ignore it.
      const ctx = kind === 'note' ? drumsCtx : undefined;
      const ids = handler.listIds(doc, ctx);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(handler.locate(doc, id, ctx)).not.toBeNull();
      }
    }
  });

  it('note handler shifts both tick and lane', () => {
    const doc = chartWithDrumTrack();
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 480,
      type: noteTypes.redDrum,
    });

    const cloned = cloneDocFor('note', doc);
    const newId = entityHandlers.note.move(
      cloned,
      noteId({tick: 480, type: noteTypes.redDrum}),
      240,
      1,
      {trackKey: {instrument: 'drums', difficulty: 'expert'}},
    );
    expect(newId).toBe(noteId({tick: 720, type: noteTypes.yellowDrum}));
    // Original untouched
    expect(doc.parsedChart.trackData[0].noteEventGroups[0][0].tick).toBe(480);
  });

  it('note handler lane shifts never cross the kick/pad boundary', () => {
    const doc = chartWithDrumTrack();
    addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 480,
      type: noteTypes.redDrum,
    });
    const ctx = {
      trackKey: {instrument: 'drums', difficulty: 'expert'},
    } as const;

    // Kick ignores lane deltas entirely (it isn't on the lane axis).
    const kickCloned = cloneDocFor('note', doc);
    const kickId = entityHandlers.note.move(
      kickCloned,
      noteId({tick: 0, type: noteTypes.kick}),
      0,
      2,
      ctx,
    );
    expect(kickId).toBe(noteId({tick: 0, type: noteTypes.kick}));

    // A pad shifted past the first pad lane clamps there instead of
    // converting to kick.
    const padCloned = cloneDocFor('note', doc);
    const padId = entityHandlers.note.move(
      padCloned,
      noteId({tick: 480, type: noteTypes.redDrum}),
      0,
      -1,
      ctx,
    );
    expect(padId).toBe(noteId({tick: 480, type: noteTypes.redDrum}));
  });

  it('dragging a cymbal onto Red destroys the cymbal flag (lane legality)', () => {
    // §6 / invariant 4: red can't hold a cymbal, so moving a yellow cymbal
    // down to the red lane must convert it to a tom (flag gone), enforced by
    // the mutator the handler calls — not by the gesture layer.
    const doc = chartWithDrumTrack();
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: 480,
      type: noteTypes.yellowDrum,
      flags: noteFlags.cymbal,
    });
    const ctx = {
      trackKey: {instrument: 'drums', difficulty: 'expert'},
    } as const;

    const cloned = cloneDocFor('note', doc);
    const newId = entityHandlers.note.move(
      cloned,
      noteId({tick: 480, type: noteTypes.yellowDrum}),
      0,
      -1, // yellow (lane 1) → red (lane 0)
      ctx,
    );
    expect(newId).toBe(noteId({tick: 480, type: noteTypes.redDrum}));
    const moved = getDrumNotes(cloned.parsedChart.trackData[0]).find(
      n => n.type === noteTypes.redDrum,
    );
    expect(moved).toBeDefined();
    expect(!!(moved!.flags & noteFlags.cymbal)).toBeFalsy();
  });

  it('note handler resolves the guitar schema from trackKey (plan 0067): green moves by tick and lane', () => {
    const doc = chartWithGuitarTrack();
    addNote(
      doc.parsedChart.trackData[0],
      {tick: 480, type: noteTypes.green},
      guitarSchema,
    );
    const ctx = {
      trackKey: {instrument: 'guitar', difficulty: 'expert'},
    } as const;

    const cloned = cloneDocFor('note', doc, ctx);
    const newId = entityHandlers.note.move(
      cloned,
      noteId({tick: 480, type: noteTypes.green}),
      240,
      1,
      ctx,
    );
    // Guitar lane order is open,green,red,yellow,blue,orange — green (lane 1)
    // shifted +1 lands on red.
    expect(newId).toBe(noteId({tick: 720, type: noteTypes.red}));
    // Original untouched.
    expect(doc.parsedChart.trackData[0].noteEventGroups[0][0].tick).toBe(480);
  });

  it('note handler resolves the guitar schema from trackKey (plan 0067): orange moves by tick and lane', () => {
    const doc = chartWithGuitarTrack();
    addNote(
      doc.parsedChart.trackData[0],
      {tick: 960, type: noteTypes.orange},
      guitarSchema,
    );
    const ctx = {
      trackKey: {instrument: 'guitar', difficulty: 'expert'},
    } as const;

    const cloned = cloneDocFor('note', doc, ctx);
    const newId = entityHandlers.note.move(
      cloned,
      noteId({tick: 960, type: noteTypes.orange}),
      -240,
      -1,
      ctx,
    );
    expect(newId).toBe(noteId({tick: 720, type: noteTypes.blue}));
  });

  it('note handler resolves the guitar schema from trackKey (plan 0067): open moves by tick and lane', () => {
    const doc = chartWithGuitarTrack();
    addNote(
      doc.parsedChart.trackData[0],
      {tick: 0, type: noteTypes.open},
      guitarSchema,
    );
    const ctx = {
      trackKey: {instrument: 'guitar', difficulty: 'expert'},
    } as const;

    const cloned = cloneDocFor('note', doc, ctx);
    // Tick-only move (open is lane-shift-excluded; lane delta 0 exercises
    // the tick axis without touching the excluded lane).
    const newId = entityHandlers.note.move(
      cloned,
      noteId({tick: 0, type: noteTypes.open}),
      480,
      0,
      ctx,
    );
    expect(newId).toBe(noteId({tick: 480, type: noteTypes.open}));
  });

  it('note handler on a guitar track under a drums4LaneSchema-only id is a no-op (cross-schema id never matches)', () => {
    // Before plan 0067, resolving the schema for a guitar trackKey still
    // pinned drums4LaneSchema, so a drum-named id like "480:redDrum" would
    // have parsed and (wrongly) matched. Confirms guitar note ids only
    // parse under the guitar schema, not the drum schema.
    const doc = chartWithGuitarTrack();
    addNote(
      doc.parsedChart.trackData[0],
      {tick: 480, type: noteTypes.red},
      guitarSchema,
    );
    const ctx = {
      trackKey: {instrument: 'guitar', difficulty: 'expert'},
    } as const;
    const cloned = cloneDocFor('note', doc, ctx);
    const drumStyleId = noteId({tick: 480, type: noteTypes.redDrum});
    const newId = entityHandlers.note.move(cloned, drumStyleId, 240, 0, ctx);
    expect(newId).toBe(drumStyleId);
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

  it('lyric handler returns clamped id (default vocals part) when drag overshoots phrase', () => {
    const doc = chartWithVocals([makePhrase(0, 480, [240])]);
    const cloned = cloneDocFor('lyric', doc);
    const newId = entityHandlers.lyric.move(cloned, 'vocals:240', 9999, 0);
    expect(newId).toBe('vocals:480');
  });

  it('phrase-start handler returns same id when fully clamped', () => {
    const doc = chartWithVocals([makePhrase(0, 480), makePhrase(960, 480)]);
    const cloned = cloneDocFor('phrase-start', doc);
    const newId = entityHandlers['phrase-start'].move(
      cloned,
      'vocals:960',
      -1000,
      0,
    );
    expect(newId).toBe('vocals:480');
  });

  it('phrase-end handler returns same id when fully clamped against next phrase', () => {
    const doc = chartWithVocals([makePhrase(0, 480), makePhrase(960, 480)]);
    const cloned = cloneDocFor('phrase-end', doc);
    const newId = entityHandlers['phrase-end'].move(
      cloned,
      'vocals:480',
      9999,
      0,
    );
    expect(newId).toBe('vocals:960');
  });
});

// ---------------------------------------------------------------------------
// listPhraseStartTicks / listPhraseEndTicks
// ---------------------------------------------------------------------------

describe('phrase listing helpers', () => {
  it('start + end ticks line up phrase by phrase', () => {
    const doc = chartWithVocals([makePhrase(0, 480), makePhrase(960, 240)]);
    expect(listPhraseStartTicks(doc)).toEqual([0, 960]);
    expect(listPhraseEndTicks(doc)).toEqual([480, 1200]);
  });
});

// ---------------------------------------------------------------------------
// Multi-part vocals — harm1/harm2/harm3 isolation
// ---------------------------------------------------------------------------

describe('multi-part vocal helpers', () => {
  it('listLyricTicks / listPhraseStartTicks return only the requested part', () => {
    const doc = chartWithMultiPartVocals({
      vocals: [makePhrase(0, 480, [240])],
      harm1: [makePhrase(960, 480, [1200])],
      harm2: [makePhrase(1920, 480, [2160])],
    });
    expect(listLyricTicks(doc, 'vocals')).toEqual([240]);
    expect(listLyricTicks(doc, 'harm1')).toEqual([1200]);
    expect(listLyricTicks(doc, 'harm2')).toEqual([2160]);
    expect(listLyricTicks(doc, 'harm3')).toEqual([]);
    expect(listPhraseStartTicks(doc, 'vocals')).toEqual([0]);
    expect(listPhraseStartTicks(doc, 'harm1')).toEqual([960]);
  });

  it('moveLyric in harm1 does not touch vocals', () => {
    const doc = chartWithMultiPartVocals({
      vocals: [makePhrase(0, 480, [240])],
      harm1: [makePhrase(0, 480, [240])],
    });
    const final = moveLyric(doc, 240, 360, 'harm1');
    expect(final).toBe(360);
    expect(listLyricTicks(doc, 'vocals')).toEqual([240]);
    expect(listLyricTicks(doc, 'harm1')).toEqual([360]);
  });

  it('movePhraseStart in harm1 does not touch vocals', () => {
    const doc = chartWithMultiPartVocals({
      vocals: [makePhrase(0, 480)],
      harm1: [makePhrase(0, 480)],
    });
    movePhraseStart(doc, 0, 120, 'harm1');
    expect(listPhraseStartTicks(doc, 'vocals')).toEqual([0]);
    expect(listPhraseStartTicks(doc, 'harm1')).toEqual([120]);
  });

  it('movePhraseEnd in harm2 does not touch other parts', () => {
    const doc = chartWithMultiPartVocals({
      vocals: [makePhrase(0, 480)],
      harm1: [makePhrase(0, 480)],
      harm2: [makePhrase(0, 480)],
    });
    movePhraseEnd(doc, 480, 600, 'harm2');
    expect(listPhraseEndTicks(doc, 'vocals')).toEqual([480]);
    expect(listPhraseEndTicks(doc, 'harm1')).toEqual([480]);
    expect(listPhraseEndTicks(doc, 'harm2')).toEqual([600]);
  });

  it('lyric handler with partName="harm1" returns harm1 ids and ignores vocals', () => {
    const doc = chartWithMultiPartVocals({
      vocals: [makePhrase(0, 480, [240])],
      harm1: [makePhrase(0, 480, [120])],
    });
    expect(entityHandlers.lyric.listIds(doc, {partName: 'harm1'})).toEqual([
      'harm1:120',
    ]);
    expect(entityHandlers.lyric.listIds(doc, {partName: 'vocals'})).toEqual([
      'vocals:240',
    ]);
    // A vocals-scoped move against a harm1 id is rejected (returns id unchanged).
    const cloned = cloneDocFor('lyric', doc);
    const unchanged = entityHandlers.lyric.move(cloned, 'harm1:120', 120, 0, {
      partName: 'vocals',
    });
    expect(unchanged).toBe('harm1:120');
    expect(listLyricTicks(cloned, 'harm1')).toEqual([120]);
  });

  it('phrase-start handler with partName="harm2" moves only that part', () => {
    const doc = chartWithMultiPartVocals({
      vocals: [makePhrase(0, 480)],
      harm2: [makePhrase(0, 480)],
    });
    const cloned = cloneDocFor('phrase-start', doc);
    const newId = entityHandlers['phrase-start'].move(
      cloned,
      'harm2:0',
      120,
      0,
      {partName: 'harm2'},
    );
    expect(newId).toBe('harm2:120');
    expect(listPhraseStartTicks(cloned, 'vocals')).toEqual([0]);
    expect(listPhraseStartTicks(cloned, 'harm2')).toEqual([120]);
  });

  it('rejects malformed ids without a part:tick separator', () => {
    const doc = chartWithMultiPartVocals({
      vocals: [makePhrase(0, 480, [240])],
    });
    expect(entityHandlers.lyric.locate(doc, '240')).toBeNull();
  });
});
