import {makeFixtureDoc} from '../../__tests__/fixtures';
import {noteId} from '@/lib/chart-edit';
import {
  LANE_CYMBAL_OK,
  PIANO_ROLL_LANES,
  extractPianoRollNotes,
  laneToRow,
  rowToLane,
} from '../notes';

describe('extractPianoRollNotes', () => {
  const drums = makeFixtureDoc().parsedChart.trackData[0];

  test('maps drum types to the 5 lanes in order', () => {
    const notes = extractPianoRollNotes(drums);
    expect(notes.map(n => [n.tick, n.lane])).toEqual([
      [0, 0], // kick
      [480, 1], // red
      [960, 2], // yellow
      [1440, 3], // blue
      [1920, 4], // green
    ]);
  });

  test('yellow cymbal is flagged as a cymbal; toms are not', () => {
    const notes = extractPianoRollNotes(drums);
    const yellow = notes.find(n => n.lane === 2)!;
    expect(yellow.cymbal).toBe(true);
    const red = notes.find(n => n.lane === 1)!;
    expect(red.cymbal).toBe(false);
  });

  test('ids match the shared selection id (tick:type)', () => {
    const notes = extractPianoRollNotes(drums);
    expect(notes.find(n => n.lane === 0)!.id).toBe(
      noteId({tick: 0, type: 'kick'}),
    );
    expect(notes.find(n => n.lane === 2)!.id).toBe(
      noteId({tick: 960, type: 'yellowDrum'}),
    );
  });

  test('null track yields no notes', () => {
    expect(extractPianoRollNotes(null)).toEqual([]);
  });

  test('kick and red lanes are not cymbal-legal', () => {
    expect(LANE_CYMBAL_OK[0]).toBe(false);
    expect(LANE_CYMBAL_OK[1]).toBe(false);
    expect(LANE_CYMBAL_OK[2]).toBe(true);
    expect(PIANO_ROLL_LANES).toHaveLength(5);
  });
});

describe('laneToRow / rowToLane', () => {
  test('display order top→bottom is Red, Yellow, Blue, Green, Kick', () => {
    expect([0, 1, 2, 3, 4].map(rowToLane)).toEqual([1, 2, 3, 4, 0]);
  });

  test('is the inverse of rowToLane for every lane', () => {
    for (let lane = 0; lane < PIANO_ROLL_LANES.length; lane++) {
      expect(rowToLane(laneToRow(lane))).toBe(lane);
    }
  });

  test('kick (lane 0) renders at the bottom row', () => {
    expect(laneToRow(0)).toBe(4);
  });
});
