import {makeFixtureDoc} from '../../__tests__/fixtures';
import {noteId} from '@/lib/chart-edit';
import {
  LANE_CYMBAL_OK,
  PIANO_ROLL_LANES,
  extractPianoRollNotes,
} from '../notes';
import {noteTypes} from '@eliwhite/scan-chart';

describe('extractPianoRollNotes', () => {
  const drums = makeFixtureDoc().parsedChart.trackData[0];

  test('maps drum types to the 5 lanes in order', () => {
    const notes = extractPianoRollNotes(drums);
    expect(notes.map(n => [n.tick, n.lane])).toEqual([
      [0, 4], // kick
      [480, 0], // red
      [960, 1], // yellow
      [1440, 2], // blue
      [1920, 3], // green
    ]);
  });

  test('yellow cymbal is flagged as a cymbal; toms are not', () => {
    const notes = extractPianoRollNotes(drums);
    const yellow = notes.find(n => n.lane === 1)!;
    expect(yellow.cymbal).toBe(true);
    const red = notes.find(n => n.lane === 0)!;
    expect(red.cymbal).toBe(false);
  });

  test('ids match the shared selection id (tick:type)', () => {
    const notes = extractPianoRollNotes(drums);
    expect(notes.find(n => n.lane === 4)!.id).toBe(
      noteId({tick: 0, type: noteTypes.kick}),
    );
    expect(notes.find(n => n.lane === 1)!.id).toBe(
      noteId({tick: 960, type: noteTypes.yellowDrum}),
    );
  });

  test('null track yields no notes', () => {
    expect(extractPianoRollNotes(null)).toEqual([]);
  });

  test('kick and red lanes are not cymbal-legal', () => {
    expect(LANE_CYMBAL_OK[0]).toBe(false); // red
    expect(LANE_CYMBAL_OK[1]).toBe(true); // yellow
    expect(LANE_CYMBAL_OK[4]).toBe(false); // kick
    expect(PIANO_ROLL_LANES).toHaveLength(5);
  });
});
