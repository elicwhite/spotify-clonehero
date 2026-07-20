/**
 * Tests for resolveNoteGeometry -- resolves a note's highway lane/full-width
 * flag/X position from the InstrumentSchema for its track's instrument.
 */

import {noteTypes, noteFlags, type NoteType} from '@eliwhite/scan-chart';
import {resolveNoteGeometry, padLaneColors} from '../notePlacement';
import {calculateNoteXOffset} from '../types';
import {guitarSchema, drums4LaneSchema} from '../../../chart-edit/instruments';

describe('resolveNoteGeometry', () => {
  describe('drums', () => {
    it('resolves kick as full-width with no lane', () => {
      const geometry = resolveNoteGeometry('drums', {
        type: noteTypes.kick,
        flags: 0,
      });
      expect(geometry).toEqual({
        lane: -1,
        isKick: true,
        isOpen: false,
        xPosition: 0,
      });
    });

    it('resolves red/yellow/blue/green to their pad lanes', () => {
      const cases: [NoteType, number][] = [
        [noteTypes.redDrum, 0],
        [noteTypes.yellowDrum, 1],
        [noteTypes.blueDrum, 2],
        [noteTypes.greenDrum, 3],
      ];
      for (const [type, lane] of cases) {
        const geometry = resolveNoteGeometry('drums', {type, flags: 0});
        expect(geometry).toEqual({
          lane,
          isKick: false,
          isOpen: false,
          xPosition: calculateNoteXOffset('drums', lane),
        });
      }
    });

    it('flips red/yellow to yellow/red lane when the disco flag is set', () => {
      // interpretDrumNote applies the disco-flip transform for drums;
      // resolveNoteGeometry must consult it rather than raw note.type.
      const redFlipped = resolveNoteGeometry('drums', {
        type: noteTypes.redDrum,
        flags: noteFlags.disco,
      });
      expect(redFlipped?.lane).toBe(1); // yellow lane

      const yellowFlipped = resolveNoteGeometry('drums', {
        type: noteTypes.yellowDrum,
        flags: noteFlags.disco,
      });
      expect(yellowFlipped?.lane).toBe(0); // red lane
    });
  });

  describe('five-fret (guitar)', () => {
    it('resolves open notes as full-width with no lane', () => {
      const geometry = resolveNoteGeometry('guitar', {
        type: noteTypes.open,
        flags: 0,
      });
      expect(geometry).toEqual({
        lane: -1,
        isKick: false,
        isOpen: true,
        xPosition: 0,
      });
    });

    it('resolves green/red/yellow/blue/orange to their pad lanes in order', () => {
      const cases: [NoteType, number][] = [
        [noteTypes.green, 0],
        [noteTypes.red, 1],
        [noteTypes.yellow, 2],
        [noteTypes.blue, 3],
        [noteTypes.orange, 4],
      ];
      for (const [type, lane] of cases) {
        const geometry = resolveNoteGeometry('guitar', {type, flags: 0});
        expect(geometry).toEqual({
          lane,
          isKick: false,
          isOpen: false,
          xPosition: calculateNoteXOffset('guitar', lane),
        });
      }
    });

    it('resolves the same way for bass/rhythm/keys (shared five-fret schema)', () => {
      for (const instrument of ['bass', 'rhythm', 'keys'] as const) {
        const geometry = resolveNoteGeometry(instrument, {
          type: noteTypes.red,
          flags: 0,
        });
        expect(geometry).toEqual({
          lane: 1,
          isKick: false,
          isOpen: false,
          xPosition: calculateNoteXOffset(instrument, 1),
        });
      }
    });
  });

  describe('unmapped notes / instruments', () => {
    it('returns null for an instrument with no schema (e.g. six-fret guitar)', () => {
      const geometry = resolveNoteGeometry('guitarghl', {
        type: noteTypes.red,
        flags: 0,
      });
      expect(geometry).toBeNull();
    });

    it('returns null for a five-fret note type on a five-fret track', () => {
      // noteTypes.black1 has no lane in the five-fret schema.
      const geometry = resolveNoteGeometry('guitar', {
        type: noteTypes.black1,
        flags: 0,
      });
      expect(geometry).toBeNull();
    });
  });
});

describe('padLaneColors', () => {
  it('returns pad lane colors in display order, sourced from the schema', () => {
    const colors = padLaneColors(guitarSchema);
    const padLanes = guitarSchema.lanes
      .filter(lane => !lane.fullWidth)
      .sort((a, b) => a.index - b.index);
    expect(colors).toEqual(padLanes.map(lane => lane.color));
    // Indexes line up with resolveNoteGeometry's `lane` output.
    const greenGeometry = resolveNoteGeometry('guitar', {
      type: noteTypes.green,
      flags: 0,
    });
    expect(colors[greenGeometry!.lane]).toBe(
      guitarSchema.lanes.find(l => l.noteType === noteTypes.green)!.color,
    );
  });

  it('excludes full-width lanes (e.g. open/kick)', () => {
    const colors = padLaneColors(guitarSchema);
    expect(colors).toHaveLength(5); // green/red/yellow/blue/orange, not open
  });

  it('works for the drum schema too', () => {
    const colors = padLaneColors(drums4LaneSchema);
    expect(colors).toHaveLength(4); // red/yellow/blue/green, not kick
  });
});
