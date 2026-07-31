import {makeFixtureDoc} from '../../__tests__/fixtures';
import {
  noteId,
  addNote,
  drums4LaneSchema,
  guitarSchema,
} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {
  extractPianoRollNotes,
  lanesForSchema,
  noteIntersectsPianoRollWindow,
} from '../notes';
import {noteFlags, noteTypes} from '@eliwhite/scan-chart';

describe('extractPianoRollNotes (drums)', () => {
  const drums = makeFixtureDoc().parsedChart.trackData[0];

  test('maps drum types to the 5 lanes in order', () => {
    const notes = extractPianoRollNotes(drums, drums4LaneSchema);
    expect(notes.map(n => [n.tick, n.lane])).toEqual([
      [0, 4], // kick
      [480, 0], // red
      [960, 1], // yellow
      [1440, 2], // blue
      [1920, 3], // green
    ]);
  });

  test('yellow cymbal is flagged as a cymbal; toms are not', () => {
    const notes = extractPianoRollNotes(drums, drums4LaneSchema);
    const yellow = notes.find(n => n.lane === 1)!;
    expect(yellow.cymbal).toBe(true);
    const red = notes.find(n => n.lane === 0)!;
    expect(red.cymbal).toBe(false);
  });

  test('does not add fret-only fields to the drum projection', () => {
    const notes = extractPianoRollNotes(drums, drums4LaneSchema);
    expect(
      notes.every(n => n.flags === undefined && n.length === undefined),
    ).toBe(true);
  });

  test('ids match the shared selection id (tick:type)', () => {
    const notes = extractPianoRollNotes(drums, drums4LaneSchema);
    expect(notes.find(n => n.lane === 4)!.id).toBe(
      noteId({tick: 0, type: noteTypes.kick}),
    );
    expect(notes.find(n => n.lane === 1)!.id).toBe(
      noteId({tick: 960, type: noteTypes.yellowDrum}),
    );
  });

  test('null track yields no notes', () => {
    expect(extractPianoRollNotes(null, drums4LaneSchema)).toEqual([]);
  });

  test('null schema yields no notes', () => {
    expect(extractPianoRollNotes(drums, null)).toEqual([]);
  });
});

describe('lanesForSchema (drums)', () => {
  const lanes = lanesForSchema(drums4LaneSchema);

  test('kick and red lanes are not cymbal-legal', () => {
    expect(lanes[0].cymbalOk).toBe(false); // red
    expect(lanes[1].cymbalOk).toBe(true); // yellow
    expect(lanes[4].cymbalOk).toBe(false); // kick
    expect(lanes).toHaveLength(5);
  });

  test('names and colors match the drum palette, unchanged from before', () => {
    expect(lanes.map(l => l.name)).toEqual([
      'Red',
      'Yellow',
      'Blue',
      'Green',
      'Kick',
    ]);
    expect(lanes.map(l => l.color)).toEqual([
      '#e5484d',
      '#f5c742',
      '#4a9ef2',
      '#5cc262',
      '#f2994a',
    ]);
  });
});

describe('extractPianoRollNotes (guitar)', () => {
  function makeGuitarTrack() {
    const track = emptyTrackData('guitar', 'expert');
    addNote(
      track,
      {tick: 0, type: noteTypes.open, length: 240, flags: noteFlags.tap},
      guitarSchema,
    );
    addNote(
      track,
      {tick: 480, type: noteTypes.green, length: 120, flags: noteFlags.hopo},
      guitarSchema,
    );
    addNote(track, {tick: 960, type: noteTypes.red}, guitarSchema);
    addNote(track, {tick: 1440, type: noteTypes.orange}, guitarSchema);
    return track;
  }

  test('produces guitar lanes + notes, not drum lanes', () => {
    const track = makeGuitarTrack();
    const lanes = lanesForSchema(guitarSchema);
    expect(lanes.map(l => l.name)).toEqual([
      'Open',
      'Green',
      'Red',
      'Yellow',
      'Blue',
      'Orange',
    ]);

    const notes = extractPianoRollNotes(track, guitarSchema);
    expect(notes.map(n => [n.tick, n.lane])).toEqual([
      [0, 0], // open
      [480, 1], // green
      [960, 2], // red
      [1440, 5], // orange
    ]);
  });

  test('no lane has cymbal legality on a five-fret schema', () => {
    const lanes = lanesForSchema(guitarSchema);
    expect(lanes.every(l => l.cymbalOk === false)).toBe(true);
  });

  test('retains fret articulation flags and sustain length', () => {
    const notes = extractPianoRollNotes(makeGuitarTrack(), guitarSchema);
    expect(notes[0]).toMatchObject({
      flags: noteFlags.tap,
      length: 240,
    });
    expect(notes[1]).toMatchObject({
      flags: noteFlags.hopo,
      length: 120,
    });
  });

  test('keeps a sustain visible after its head crosses the left edge', () => {
    expect(noteIntersectsPianoRollWindow(-500, 250, 0, 100)).toBe(true);
    expect(noteIntersectsPianoRollWindow(-500, -51, 0, 100)).toBe(false);
  });
});
