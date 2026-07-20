/**
 * Round-trip parity harness (plan 0061 §5) — the safety net for the
 * in-memory edit path.
 *
 * The invariant every mutator must uphold: after a helper runs, the chart's
 * derived timing is already what a `writeChartFolder → parseChartFile` round
 * trip would produce, so the edit-loop round trip can eventually be removed
 * (phase 2) without any field silently drifting. Each test mutates an
 * in-memory `ChartDocument`, then serializes + reparses it and asserts the
 * two agree on the fields the mutators maintain:
 *
 *  - ticks, lengths, note grouping (chords), tempo BPM values: EXACT.
 *  - `msTime` / `msLength`: exact to 1e-6 (the mutators replicate
 *    scan-chart's `setEventMsTimes` arithmetic, so this is really bit-for-bit;
 *    the epsilon guards only against float formatting on the `.chart` text).
 *  - drum cymbal/doubleKick/accent/ghost/flam semantics: EXACT (the parser's
 *    tom-default normalization is not maintained by the mutators and is
 *    excluded — "not a cymbal" is what the mutators track).
 *
 * Because the invariant only holds relative to a normalized starting doc,
 * every fixture is built and then round-tripped ONCE (`parseDoc`) so the
 * baseline itself is parser-normalized before any mutation under test.
 */

import {parseChartFile, defaultIniChartModifiers} from '@eliwhite/scan-chart';
import type {ChartDocument, ParsedTrackData} from '../types';
import {
  createEmptyChart,
  writeChartFolder,
  noteFlags,
  drumTypes,
  addDrumNote,
  removeDrumNote,
  setDrumNoteFlags,
  addStarPower,
  removeStarPower,
  addActivationLane,
  removeActivationLane,
  addSoloSection,
  removeSoloSection,
  addFlexLane,
  removeFlexLane,
  addTempo,
  removeTempo,
  addTimeSignature,
  removeTimeSignature,
  addSection,
  removeSection,
  moveLyric,
  movePhraseStart,
  movePhraseEnd,
  cloneDocFor,
  entityHandlers,
  noteId,
  makeChartTiming,
  retimeChart,
  quantizeBpm,
} from '../index';
import {tickToMs} from '@/lib/drum-transcription/timing';
import {emptyTrackData} from './test-utils';
import {noteTypes} from '@eliwhite/scan-chart';

// ---------------------------------------------------------------------------
// Round-trip plumbing
// ---------------------------------------------------------------------------

const MODIFIERS = {...defaultIniChartModifiers, pro_drums: true};

/** Serialize + reparse a doc, mirroring the editor's rebuild path. */
function parseDoc(doc: ChartDocument): ChartDocument {
  const format = doc.parsedChart.format ?? 'chart';
  const modifiers = doc.parsedChart.iniChartModifiers ?? MODIFIERS;
  const files = writeChartFolder({
    parsedChart: doc.parsedChart,
    assets: doc.assets,
  });
  const chartFileName = format === 'chart' ? 'notes.chart' : 'notes.mid';
  const chartFile = files.find(f => f.fileName === chartFileName)!;
  const parsed = parseChartFile(chartFile.data, format, modifiers);
  return {
    parsedChart: {
      ...parsed,
      chartBytes: chartFile.data,
      format,
      iniChartModifiers: modifiers,
    },
    assets: doc.assets,
  };
}

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

function drumTrack(doc: ChartDocument): ParsedTrackData {
  const track = doc.parsedChart.trackData.find(t => t.instrument === 'drums');
  if (!track) throw new Error('fixture has no drum track');
  return track;
}

// ---------------------------------------------------------------------------
// Projections — the fields the mutators are responsible for maintaining
// ---------------------------------------------------------------------------

function projectNotes(track: ParsedTrackData) {
  const notes = track.noteEventGroups.flat().map(n => ({
    tick: n.tick,
    type: n.type,
    length: n.length,
    cymbal: (n.flags & noteFlags.cymbal) !== 0,
    doubleKick: (n.flags & noteFlags.doubleKick) !== 0,
    accent: (n.flags & noteFlags.accent) !== 0,
    ghost: (n.flags & noteFlags.ghost) !== 0,
    flam: (n.flags & noteFlags.flam) !== 0,
    msTime: r6(n.msTime),
    msLength: r6(n.msLength),
  }));
  notes.sort((a, b) => a.tick - b.tick || a.type - b.type);
  return notes;
}

function projectSpan(s: {
  tick: number;
  length: number;
  msTime: number;
  msLength: number;
}) {
  return {
    tick: s.tick,
    length: s.length,
    msTime: r6(s.msTime),
    msLength: r6(s.msLength),
  };
}

/** Everything serialized through the `.chart` note/tempo/section tracks. */
function projectDoc(doc: ChartDocument) {
  const c = doc.parsedChart;
  const track = c.trackData.find(t => t.instrument === 'drums');
  return {
    resolution: c.resolution,
    tempos: c.tempos.map(t => ({
      tick: t.tick,
      beatsPerMinute: t.beatsPerMinute,
      msTime: r6(t.msTime),
    })),
    timeSignatures: c.timeSignatures.map(ts => ({
      tick: ts.tick,
      numerator: ts.numerator,
      denominator: ts.denominator,
      msTime: r6(ts.msTime),
    })),
    sections: c.sections.map(s => ({
      tick: s.tick,
      name: s.name,
      msTime: r6(s.msTime),
    })),
    notes: track ? projectNotes(track) : [],
    starPower: track ? track.starPowerSections.map(projectSpan) : [],
    solo: track ? track.soloSections.map(projectSpan) : [],
    flex: track
      ? track.flexLanes.map(fl => ({...projectSpan(fl), isDouble: fl.isDouble}))
      : [],
    activation: track
      ? track.drumFreestyleSections.map(fs => ({
          ...projectSpan(fs),
          isCoda: fs.isCoda,
        }))
      : [],
  };
}

/** Assert: the in-memory doc already matches its own write→parse image. */
function assertParity(doc: ChartDocument) {
  expect(projectDoc(doc)).toEqual(projectDoc(parseDoc(doc)));
}

// ---------------------------------------------------------------------------
// Fixture: a multi-tempo, multi-meter chart with a rich drum track
// ---------------------------------------------------------------------------

function baselineDoc(): ChartDocument {
  const parsedChart = createEmptyChart({bpm: 120, resolution: 480});
  parsedChart.iniChartModifiers = {
    ...parsedChart.iniChartModifiers,
    pro_drums: true,
  };
  // chart-level drumType gates cymbal-marker serialization in the writer.
  parsedChart.drumType = drumTypes.fourLanePro;
  parsedChart.tempos.push({tick: 1920, beatsPerMinute: 140, msTime: 0});
  parsedChart.tempos.push({tick: 3840, beatsPerMinute: 95.5, msTime: 0});
  parsedChart.timeSignatures.push({
    tick: 1920,
    numerator: 3,
    denominator: 4,
    msTime: 0,
    msLength: 0,
  });

  const track = emptyTrackData('drums', 'expert');
  parsedChart.trackData.push(track);
  const doc: ChartDocument = {parsedChart, assets: []};

  // A chord (kick + red at tick 0), a cymbal, flagged notes, a sustain, and
  // notes in every tempo region.
  addDrumNote(track, {tick: 0, type: noteTypes.kick});
  addDrumNote(track, {tick: 0, type: noteTypes.redDrum});
  addDrumNote(track, {
    tick: 480,
    type: noteTypes.yellowDrum,
    flags: noteFlags.cymbal,
  });
  addDrumNote(track, {
    tick: 960,
    type: noteTypes.blueDrum,
    flags: noteFlags.ghost,
  });
  addDrumNote(track, {
    tick: 2400,
    type: noteTypes.greenDrum,
    length: 240,
    flags: noteFlags.accent,
  });
  addDrumNote(track, {
    tick: 4000,
    type: noteTypes.kick,
    flags: noteFlags.doubleKick,
  });
  addStarPower(track, 0, 1920);
  addSoloSection(track, 2400, 480);
  addActivationLane(track, 3000, 240);
  addFlexLane(track, 3500, 120, true);
  addSection(doc, 0, 'Intro');
  addSection(doc, 1920, 'Verse');

  // Normalize once so the baseline is already parser-shaped.
  return parseDoc(doc);
}

// ---------------------------------------------------------------------------
// Sanity: an unmutated baseline is already at its own fixed point
// ---------------------------------------------------------------------------

describe('parity harness — baseline', () => {
  it('a normalized fixture round-trips to itself', () => {
    assertParity(baselineDoc());
  });

  it('retimeChart reproduces the parser msTimes after they are corrupted', () => {
    const doc = baselineDoc();
    const c = doc.parsedChart;
    // Corrupt every derived timing field to prove retimeChart recomputes it.
    for (const t of c.tempos) t.msTime = -1;
    for (const ts of c.timeSignatures) ((ts.msTime = -1), (ts.msLength = -1));
    for (const s of c.sections) ((s.msTime = -1), (s.msLength = -1));
    const track = drumTrack(doc);
    for (const g of track.noteEventGroups)
      for (const n of g) ((n.msTime = -1), (n.msLength = -1));
    for (const sp of track.starPowerSections)
      ((sp.msTime = -1), (sp.msLength = -1));

    retimeChart(c);
    assertParity(doc);
  });
});

// ---------------------------------------------------------------------------
// Drum-note mutators
// ---------------------------------------------------------------------------

describe('parity harness — drum notes', () => {
  it('addDrumNote (tom pad in the 140bpm region) maintains timing', () => {
    const doc = baselineDoc();
    const track = drumTrack(doc);
    addDrumNote(
      track,
      {tick: 2160, type: noteTypes.yellowDrum, flags: noteFlags.tom},
      makeChartTiming(doc.parsedChart),
    );
    assertParity(doc);
  });

  it('addDrumNote (cymbal) preserves the cymbal flag through the round trip', () => {
    const doc = baselineDoc();
    const track = drumTrack(doc);
    addDrumNote(
      track,
      {tick: 4320, type: noteTypes.blueDrum, flags: noteFlags.cymbal},
      makeChartTiming(doc.parsedChart),
    );
    assertParity(doc);
    const added = track.noteEventGroups.flat().find(n => n.tick === 4320)!;
    expect(added.flags & noteFlags.cymbal).not.toBe(0);
    expect(r6(added.msTime)).toBe(
      r6(tickToMs(4320, doc.parsedChart.tempos, doc.parsedChart.resolution)),
    );
  });

  it('addDrumNote (sustain) computes msLength across a tempo change', () => {
    const doc = baselineDoc();
    const track = drumTrack(doc);
    // Sustain that starts before and ends after the tick-3840 tempo change.
    addDrumNote(
      track,
      {
        tick: 3600,
        type: noteTypes.greenDrum,
        length: 600,
        flags: noteFlags.cymbal,
      },
      makeChartTiming(doc.parsedChart),
    );
    assertParity(doc);
  });

  it('addDrumNote into an existing group keeps the chord on one tick', () => {
    const doc = baselineDoc();
    const track = drumTrack(doc);
    addDrumNote(
      track,
      {tick: 480, type: noteTypes.blueDrum},
      makeChartTiming(doc.parsedChart),
    );
    assertParity(doc);
  });

  it('removeDrumNote leaves the surviving chord note timed correctly', () => {
    const doc = baselineDoc();
    const track = drumTrack(doc);
    removeDrumNote(track, 0, noteTypes.redDrum);
    assertParity(doc);
  });

  it('setDrumNoteFlags does not disturb timing', () => {
    const doc = baselineDoc();
    const track = drumTrack(doc);
    setDrumNoteFlags(track, 960, noteTypes.blueDrum, noteFlags.accent);
    assertParity(doc);
  });
});

// ---------------------------------------------------------------------------
// Drum-section mutators
// ---------------------------------------------------------------------------

describe('parity harness — drum sections', () => {
  const cases: Array<
    [
      string,
      (t: ParsedTrackData, timing: ReturnType<typeof makeChartTiming>) => void,
    ]
  > = [
    ['addStarPower', (t, tm) => addStarPower(t, 2400, 960, tm)],
    ['removeStarPower', t => removeStarPower(t, 0)],
    ['addSoloSection', (t, tm) => addSoloSection(t, 3840, 480, tm)],
    ['removeSoloSection', t => removeSoloSection(t, 2400)],
    ['addActivationLane', (t, tm) => addActivationLane(t, 4200, 240, tm)],
    ['removeActivationLane', t => removeActivationLane(t, 3000)],
    ['addFlexLane', (t, tm) => addFlexLane(t, 4500, 120, false, tm)],
    ['removeFlexLane', t => removeFlexLane(t, 3500)],
  ];
  for (const [name, mutate] of cases) {
    it(`${name} maintains timing`, () => {
      const doc = baselineDoc();
      mutate(drumTrack(doc), makeChartTiming(doc.parsedChart));
      assertParity(doc);
    });
  }
});

// ---------------------------------------------------------------------------
// Section markers
// ---------------------------------------------------------------------------

describe('parity harness — sections', () => {
  it('addSection in the 140bpm region computes msTime', () => {
    const doc = baselineDoc();
    addSection(doc, 2400, 'Chorus');
    assertParity(doc);
  });

  it('removeSection keeps the rest timed', () => {
    const doc = baselineDoc();
    removeSection(doc, 1920);
    assertParity(doc);
  });
});

// ---------------------------------------------------------------------------
// Tempo + time-signature mutators (whole-chart retime)
// ---------------------------------------------------------------------------

describe('parity harness — tempo / time signature', () => {
  it('addTempo mid-song re-times every downstream event', () => {
    const doc = baselineDoc();
    addTempo(doc, 960, 175);
    assertParity(doc);
  });

  it('removeTempo re-times every downstream event', () => {
    const doc = baselineDoc();
    removeTempo(doc, 1920);
    assertParity(doc);
  });

  it('addTimeSignature is timed and does not move notes', () => {
    const doc = baselineDoc();
    const before = projectNotes(drumTrack(doc));
    addTimeSignature(doc, 3840, 7, 8);
    assertParity(doc);
    expect(projectNotes(drumTrack(doc))).toEqual(before);
  });

  it('removeTimeSignature maintains parity', () => {
    const doc = baselineDoc();
    removeTimeSignature(doc, 1920);
    assertParity(doc);
  });
});

// ---------------------------------------------------------------------------
// Format quantization (plan 0061 §2)
// ---------------------------------------------------------------------------

describe('parity harness — format-quantized BPM', () => {
  it('quantizeBpm is a fixed point of the .chart milli-BPM round trip', () => {
    const q = quantizeBpm(140.123456, 'chart');
    expect(q).toBe(140.123);
    expect(quantizeBpm(q, 'chart')).toBe(q);
  });

  it('quantizeBpm is a fixed point of the .mid µs-per-beat round trip', () => {
    const q = quantizeBpm(140.123456, 'mid');
    // Writing 6e7/q and re-parsing yields q exactly.
    expect(6e7 / Math.round(6e7 / q)).toBe(q);
  });

  it('a tempo edit to an arbitrary BPM stores a serialization-exact value', () => {
    const doc = baselineDoc();
    addTempo(doc, 960, 137.7654321);
    const edited = doc.parsedChart.tempos.find(t => t.tick === 960)!;
    // Stored value is already the .chart-representable value.
    expect(edited.beatsPerMinute).toBe(quantizeBpm(137.7654321, 'chart'));
    // write→parse changes NO tempo value and shifts NO downstream ms.
    const reparsed = parseDoc(doc);
    expect(reparsed.parsedChart.tempos.map(t => t.beatsPerMinute)).toEqual(
      doc.parsedChart.tempos.map(t => t.beatsPerMinute),
    );
    assertParity(doc);
  });
});

// ---------------------------------------------------------------------------
// Entity-handler moves (the editor's note/section move path)
// ---------------------------------------------------------------------------

describe('parity harness — entity moves', () => {
  const drumCtx = {
    trackKey: {instrument: 'drums', difficulty: 'expert'},
  } as const;

  it('note move across a tempo boundary re-times the moved note', () => {
    const doc = baselineDoc();
    const cloned = cloneDocFor('note', doc);
    // Move the tick-960 blue note into the 140bpm region.
    entityHandlers.note.move(
      cloned,
      noteId({tick: 960, type: noteTypes.blueDrum}),
      1200,
      0,
      drumCtx,
    );
    assertParity(cloned);
    const moved = drumTrack(cloned)
      .noteEventGroups.flat()
      .find(n => n.tick === 2160)!;
    expect(r6(moved.msTime)).toBe(
      r6(
        tickToMs(
          2160,
          cloned.parsedChart.tempos,
          cloned.parsedChart.resolution,
        ),
      ),
    );
  });

  it('section move re-times the moved section', () => {
    const doc = baselineDoc();
    const cloned = cloneDocFor('section', doc);
    entityHandlers.section.move(cloned, '1920', 480, 0);
    assertParity(cloned);
  });
});

// ---------------------------------------------------------------------------
// Vocal mutators — lyrics + phrases (notes are not serialized to .chart,
// so parity is asserted on the lyric/phrase fields that are)
// ---------------------------------------------------------------------------

function vocalDoc(): ChartDocument {
  const parsedChart = createEmptyChart({bpm: 120, resolution: 480});
  parsedChart.tempos.push({tick: 1920, beatsPerMinute: 150, msTime: 0});
  parsedChart.vocalTracks = {
    parts: {
      vocals: {
        notePhrases: [
          {
            tick: 0,
            msTime: 0,
            length: 960,
            msLength: 0,
            isPercussion: false,
            notes: [
              {
                tick: 120,
                msTime: 0,
                length: 60,
                msLength: 0,
                pitch: 60,
                type: 'pitched',
              },
              {
                tick: 600,
                msTime: 0,
                length: 60,
                msLength: 0,
                pitch: 62,
                type: 'pitched',
              },
            ],
            lyrics: [
              {tick: 120, msTime: 0, text: 'a', flags: 0},
              {tick: 600, msTime: 0, text: 'b', flags: 0},
            ],
          },
          {
            tick: 2160,
            msTime: 0,
            length: 480,
            msLength: 0,
            isPercussion: false,
            notes: [
              {
                tick: 2280,
                msTime: 0,
                length: 60,
                msLength: 0,
                pitch: 64,
                type: 'pitched',
              },
            ],
            lyrics: [{tick: 2280, msTime: 0, text: 'c', flags: 0}],
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
  const doc: ChartDocument = {parsedChart, assets: []};
  // Establish correct baseline timing.
  retimeChart(parsedChart);
  return doc;
}

function projectVocals(doc: ChartDocument) {
  const part = doc.parsedChart.vocalTracks!.parts['vocals'];
  return part.notePhrases.map(p => ({
    tick: p.tick,
    length: p.length,
    msTime: r6(p.msTime),
    msLength: r6(p.msLength),
    lyrics: p.lyrics.map(l => ({
      tick: l.tick,
      text: l.text,
      msTime: r6(l.msTime),
    })),
  }));
}

describe('parity harness — vocals', () => {
  it('baseline vocal lyrics + phrase timing round-trip through .chart', () => {
    const doc = vocalDoc();
    expect(projectVocals(doc)).toEqual(projectVocals(parseDoc(doc)));
  });

  it('moveLyric re-times the lyric and its paired note', () => {
    const doc = vocalDoc();
    const timing = makeChartTiming(doc.parsedChart);
    const finalTick = moveLyric(doc, 600, 720);
    expect(finalTick).toBe(720);
    const part = doc.parsedChart.vocalTracks!.parts['vocals'];
    const lyric = part.notePhrases[0].lyrics.find(l => l.tick === 720)!;
    const note = part.notePhrases[0].notes.find(n => n.tick === 720)!;
    const expected = r6(tickToMs(720, timing.timedTempos, timing.resolution));
    expect(r6(lyric.msTime)).toBe(expected);
    expect(r6(note.msTime)).toBe(expected);
    // Lyric-level parity through the writer.
    expect(projectVocals(doc)).toEqual(projectVocals(parseDoc(doc)));
  });

  it('movePhraseStart re-times the phrase (msTime + msLength)', () => {
    const doc = vocalDoc();
    const timing = makeChartTiming(doc.parsedChart);
    movePhraseStart(doc, 0, 240);
    const phrase = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0];
    expect(phrase.tick).toBe(240);
    expect(r6(phrase.msTime)).toBe(
      r6(tickToMs(240, timing.timedTempos, timing.resolution)),
    );
    expect(projectVocals(doc)).toEqual(projectVocals(parseDoc(doc)));
  });

  it('movePhraseEnd re-times the phrase length across a tempo change', () => {
    const doc = vocalDoc();
    const timing = makeChartTiming(doc.parsedChart);
    // Phrase 2 starts at 2160 (post 150bpm change); grow its end.
    movePhraseEnd(doc, 2640, 2880);
    const phrase = doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases[1];
    expect(phrase.length).toBe(2880 - 2160);
    const endMs = tickToMs(2880, timing.timedTempos, timing.resolution);
    const startMs = tickToMs(2160, timing.timedTempos, timing.resolution);
    expect(r6(phrase.msLength)).toBe(r6(endMs - startMs));
    expect(projectVocals(doc)).toEqual(projectVocals(parseDoc(doc)));
  });
});
