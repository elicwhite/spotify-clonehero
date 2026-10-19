import type {NoteType} from '@eliwhite/scan-chart';
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
  movePhrases,
  phraseTranslationBounds,
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
// Whole-phrase translation — what selecting a phrase's start AND end edge
// and dragging its words does.
// ---------------------------------------------------------------------------

describe('phraseTranslationBounds', () => {
  const spans = [
    {tick: 0, length: 480},
    {tick: 960, length: 480},
    {tick: 1920, length: 480},
  ];

  it('bounds a phrase by the neighbors that are staying put', () => {
    // Phrase 960..1440 can back up to 480 (phrase 0's end) and run out to
    // 1920 (phrase 2's start).
    expect(phraseTranslationBounds(spans, [960])).toEqual({
      minDelta: -480,
      maxDelta: 480,
    });
  });

  it('lets a phrase run to tick 0 and no further when nothing precedes it', () => {
    expect(phraseTranslationBounds(spans, [0])).toEqual({
      minDelta: 0,
      maxDelta: 480,
    });
  });

  it('is unbounded on the right past the last phrase', () => {
    expect(phraseTranslationBounds(spans, [1920]).maxDelta).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('ignores phrases inside the moving set, so a group keeps its spacing', () => {
    // 960 and 1920 move together: 960 does not clamp against 1920, and the
    // group as a whole is bounded by phrase 0 on the left, nothing on the
    // right.
    expect(phraseTranslationBounds(spans, [960, 1920])).toEqual({
      minDelta: -480,
      maxDelta: Number.POSITIVE_INFINITY,
    });
  });

  it('intersects the bounds across the moving set', () => {
    // 0 and 1920 move while 960 stays. Right: phrase 0 can only advance 480
    // before hitting it, against 1920's unbounded run — 480 wins. Left:
    // 1920 can back up 480, but phrase 0 is already at tick 0 — 0 wins.
    expect(phraseTranslationBounds(spans, [0, 1920])).toEqual({
      minDelta: 0,
      maxDelta: 480,
    });
  });

  it('reports no room when nothing in the moving set exists', () => {
    expect(phraseTranslationBounds(spans, [12345])).toEqual({
      minDelta: 0,
      maxDelta: 0,
    });
  });
});

describe('movePhrases', () => {
  it('translates the phrase, its lyrics and its notes, keeping the length', () => {
    const doc = chartWithVocals([makePhrase(960, 480, [1080, 1200])]);
    expect(movePhrases(doc, [960], 240)).toBe(240);

    const phrase = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0];
    expect(phrase.tick).toBe(1200);
    expect(phrase.length).toBe(480);
    expect(phrase.lyrics.map(l => l.tick)).toEqual([1320, 1440]);
    expect(phrase.notes.map(n => n.tick)).toEqual([1320, 1440]);
  });

  it('recomputes ms timing for the phrase and everything in it', () => {
    // 480 ticks = 500ms at the fixture's 120 BPM / 480 resolution.
    const doc = chartWithVocals([makePhrase(0, 480, [240])]);
    movePhrases(doc, [0], 480);
    const phrase = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0];
    expect(phrase.msTime).toBeCloseTo(500);
    expect(phrase.lyrics[0].msTime).toBeCloseTo(750);
  });

  it('clamps the group so it stops at the neighbor rather than overlapping', () => {
    const doc = chartWithVocals([makePhrase(0, 480), makePhrase(960, 480)]);
    expect(movePhrases(doc, [960], -9999)).toBe(-480);
    const phrases = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases;
    expect(phrases.map(p => p.tick)).toEqual([0, 480]);
  });

  it('moves co-selected phrases rigidly, at one shared clamped delta', () => {
    const doc = chartWithVocals([
      makePhrase(0, 480),
      makePhrase(960, 480),
      makePhrase(1920, 480),
    ]);
    // Phrases 2 and 3 move together; phrase 1 stops them 480 ticks short of
    // the 9999 asked for, and BOTH stop there so the gap between them holds.
    expect(movePhrases(doc, [960, 1920], -9999)).toBe(-480);
    const phrases = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases;
    expect(phrases.map(p => p.tick)).toEqual([0, 480, 1440]);
  });

  it('stops a phrase butting up against the next one, never on top of it', () => {
    const doc = chartWithVocals([makePhrase(0, 480), makePhrase(960, 480)]);
    expect(movePhrases(doc, [0], 9999)).toBe(480);
    const phrases = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases;
    expect(phrases.map(p => p.tick + p.length)).toEqual([960, 1440]);
  });

  it('is a no-op for a delta of zero, an unknown tick, or a chart with no vocals', () => {
    const doc = chartWithVocals([makePhrase(0, 480)]);
    expect(movePhrases(doc, [0], 0)).toBe(0);
    expect(movePhrases(doc, [999], 240)).toBe(0);
    expect(movePhrases(emptyChart(), [0], 240)).toBe(0);
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

  describe('note handler moveMany (batch note move)', () => {
    const drumsCtx = {
      trackKey: {instrument: 'drums', difficulty: 'expert'},
    } as const;

    function docWith(notes: {tick: number; type: NoteType}[]): ChartDocument {
      const doc = chartWithDrumTrack();
      const drums = doc.parsedChart.trackData[0];
      for (const n of notes) addDrumNote(drums, n);
      return doc;
    }

    function ticksAndTypes(doc: ChartDocument) {
      return getDrumNotes(doc.parsedChart.trackData[0])
        .map(n => `${n.tick}:${n.type}`)
        .sort();
    }

    // The ordering hazard: a note ids by (tick, type), so moving the pair one
    // at a time would look the second one up in a track the first move has
    // already rewritten. Blue→yellow lands exactly where yellow still sits.
    it('does not lose a note whose destination another selected note occupies', () => {
      const doc = docWith([
        {tick: 100, type: noteTypes.yellowDrum},
        {tick: 100, type: noteTypes.blueDrum},
      ]);
      const out = cloneDocFor('note', doc, drumsCtx);
      entityHandlers.note.moveMany!(
        out,
        [
          noteId({tick: 100, type: noteTypes.yellowDrum}),
          noteId({tick: 100, type: noteTypes.blueDrum}),
        ],
        0,
        -1,
        drumsCtx,
      );
      // yellow→red, blue→yellow. Two notes in, two notes out.
      expect(ticksAndTypes(out)).toEqual(
        [`100:${noteTypes.redDrum}`, `100:${noteTypes.yellowDrum}`].sort(),
      );
    });

    it('dedupes a note dropped exactly onto an existing one', () => {
      const doc = docWith([
        {tick: 100, type: noteTypes.yellowDrum},
        {tick: 100, type: noteTypes.blueDrum},
      ]);
      const out = cloneDocFor('note', doc, drumsCtx);
      // Move only blue down onto yellow's slot; yellow stays put.
      entityHandlers.note.moveMany!(
        out,
        [noteId({tick: 100, type: noteTypes.blueDrum})],
        0,
        -1,
        drumsCtx,
      );
      expect(ticksAndTypes(out)).toEqual([`100:${noteTypes.yellowDrum}`]);
    });

    it('moves a pad note onto kick', () => {
      const doc = docWith([{tick: 480, type: noteTypes.greenDrum}]);
      const out = cloneDocFor('note', doc, drumsCtx);
      entityHandlers.note.moveMany!(
        out,
        [noteId({tick: 480, type: noteTypes.greenDrum})],
        0,
        1,
        drumsCtx,
      );
      expect(ticksAndTypes(out)).toEqual([`480:${noteTypes.kick}`]);
    });

    it('keeps a run intact when it shifts lane', () => {
      const doc = docWith([
        {tick: 0, type: noteTypes.blueDrum},
        {tick: 480, type: noteTypes.blueDrum},
        {tick: 960, type: noteTypes.blueDrum},
      ]);
      const out = cloneDocFor('note', doc, drumsCtx);
      entityHandlers.note.moveMany!(
        out,
        [0, 480, 960].map(tick => noteId({tick, type: noteTypes.blueDrum})),
        0,
        -1,
        drumsCtx,
      );
      expect(ticksAndTypes(out)).toEqual(
        [0, 480, 960].map(t => `${t}:${noteTypes.yellowDrum}`).sort(),
      );
    });
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
