/**
 * Tests for trackToElements -- converts scan-chart Track to ChartElement[].
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import {trackToElements} from '../trackToElements';
import type {Track} from '../types';
import type {NoteElementData} from '../NoteRenderer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Track for testing. */
function makeTrack(
  noteEventGroups: Track['noteEventGroups'],
  opts?: {
    instrument?: Track['instrument'];
    starPowerSections?: Track['starPowerSections'];
  },
): Track {
  return {
    instrument: opts?.instrument ?? 'drums',
    difficulty: 'expert',
    noteEventGroups,
    starPowerSections: opts?.starPowerSections ?? [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    flexLaneSections: [],
    drumFreestyleSections: [],
  } as unknown as Track;
}

/** Create a note event for a track group. */
function note(
  type: number,
  tick: number,
  msTime: number,
  flags = 0,
  msLength = 0,
): Track['noteEventGroups'][0][0] {
  return {
    type,
    tick,
    msTime,
    flags,
    msLength,
  } as Track['noteEventGroups'][0][0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trackToElements', () => {
  it('converts empty track to empty array', () => {
    const track = makeTrack([]);
    const elements = trackToElements(track);
    expect(elements).toHaveLength(0);
  });

  it('converts kick note to element with key note:tick:kick', () => {
    const track = makeTrack([[note(noteTypes.kick, 0, 0)]]);
    const elements = trackToElements(track);

    expect(elements).toHaveLength(1);
    expect(elements[0].key).toBe('note:0:kick');
    expect(elements[0].kind).toBe('note');
    expect(elements[0].msTime).toBe(0);

    const data = elements[0].data as NoteElementData;
    expect(data.isKick).toBe(true);
    expect(data.lane).toBe(-1);
  });

  it('converts drum notes with correct msTime', () => {
    const track = makeTrack([
      [note(noteTypes.redDrum, 480, 500)],
      [note(noteTypes.yellowDrum, 960, 1000)],
    ]);
    const elements = trackToElements(track);

    expect(elements).toHaveLength(2);
    expect(elements[0].msTime).toBe(500);
    expect(elements[0].key).toBe('note:480:redDrum');
    expect(elements[1].msTime).toBe(1000);
    expect(elements[1].key).toBe('note:960:yellowDrum');
  });

  it('converts cymbal flags correctly', () => {
    const track = makeTrack([
      [note(noteTypes.yellowDrum, 480, 500, noteFlags.cymbal)],
    ]);
    const elements = trackToElements(track);

    expect(elements).toHaveLength(1);
    const data = elements[0].data as NoteElementData;
    expect(data.note.flags).toBe(noteFlags.cymbal);
  });

  it('converts chord (multiple notes at same tick) to separate elements', () => {
    const track = makeTrack([
      [
        note(noteTypes.redDrum, 480, 500),
        note(noteTypes.yellowDrum, 480, 500, noteFlags.cymbal),
      ],
    ]);
    const elements = trackToElements(track);

    expect(elements).toHaveLength(2);
    expect(elements[0].key).toBe('note:480:redDrum');
    expect(elements[1].key).toBe('note:480:yellowDrum');
    // Different x positions
    const data0 = elements[0].data as NoteElementData;
    const data1 = elements[1].data as NoteElementData;
    expect(data0.xPosition).not.toBe(data1.xPosition);
  });

  it('handles star power sections', () => {
    const track = makeTrack(
      [[note(noteTypes.redDrum, 0, 0)], [note(noteTypes.redDrum, 960, 1000)]],
      {
        starPowerSections: [{tick: 0, msTime: 0, msLength: 500, length: 480}],
      },
    );
    const elements = trackToElements(track);

    expect(elements).toHaveLength(2);
    const data0 = elements[0].data as NoteElementData;
    const data1 = elements[1].data as NoteElementData;
    expect(data0.inStarPower).toBe(true);
    expect(data1.inStarPower).toBe(false);
  });

  it('produces elements sorted by msTime (from note event groups)', () => {
    const track = makeTrack([
      [note(noteTypes.redDrum, 0, 0)],
      [note(noteTypes.yellowDrum, 480, 500)],
      [note(noteTypes.blueDrum, 960, 1000)],
    ]);
    const elements = trackToElements(track);
    const msTimes = elements.map(e => e.msTime);
    expect(msTimes).toEqual([...msTimes].sort((a, b) => a - b));
  });
});
