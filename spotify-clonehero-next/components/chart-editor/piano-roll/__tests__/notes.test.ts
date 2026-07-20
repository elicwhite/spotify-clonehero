import {makeFixtureDoc} from '../../__tests__/fixtures';
import {
  noteId,
  addNote,
  drums4LaneSchema,
  guitarSchema,
} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {extractPianoRollNotes, lanesForSchema} from '../notes';
import {noteTypes} from '@eliwhite/scan-chart';

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
    addNote(track, {tick: 0, type: noteTypes.open}, guitarSchema);
    addNote(track, {tick: 480, type: noteTypes.green}, guitarSchema);
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
});
