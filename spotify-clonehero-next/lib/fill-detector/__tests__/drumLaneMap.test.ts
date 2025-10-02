/**
 * Unit tests for drum lane mapping
 */

import {
  mapNoteToVoice,
  mapScanChartNoteToVoice,
  groupNotesByVoice,
  countNotesByVoice,
  getTotalNotesInVoices,
  isTom,
  isHat,
  isKick,
  isCymbal,
  CLONE_HERO_DRUM_MAP,
  ROCK_BAND_4_DRUM_MAP,
} from '../drumLaneMap';
import {DrumVoice} from '../types';
import type {NoteType} from '@eliwhite/scan-chart';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';

describe('Drum Lane Mapping', () => {
  describe('mapNoteToVoice', () => {
    it('should use Clone Hero mapping by default', () => {
      expect(mapNoteToVoice(0)).toBe(DrumVoice.KICK);
      expect(mapNoteToVoice(1)).toBe(DrumVoice.SNARE);
      expect(mapNoteToVoice(2)).toBe(DrumVoice.HAT);
      expect(mapNoteToVoice(3)).toBe(DrumVoice.TOM);
      expect(mapNoteToVoice(4)).toBe(DrumVoice.CYMBAL);
      expect(mapNoteToVoice(5)).toBe(DrumVoice.TOM);
    });

    it('should return UNKNOWN for unmapped note types', () => {
      expect(mapNoteToVoice(99 as unknown as NoteType)).toBe(DrumVoice.UNKNOWN);
    });

    it('should use custom mapping when provided', () => {
      const customMap = {
        0: DrumVoice.SNARE,
        1: DrumVoice.KICK,
      };

      expect(mapNoteToVoice(0, customMap)).toBe(DrumVoice.SNARE);
      expect(mapNoteToVoice(1, customMap)).toBe(DrumVoice.KICK);
      expect(mapNoteToVoice(2, customMap)).toBe(DrumVoice.UNKNOWN);
    });

    it('should work with Rock Band 4 mapping', () => {
      expect(mapNoteToVoice(0, ROCK_BAND_4_DRUM_MAP)).toBe(DrumVoice.KICK);
      expect(mapNoteToVoice(1, ROCK_BAND_4_DRUM_MAP)).toBe(DrumVoice.SNARE);
      expect(mapNoteToVoice(2, ROCK_BAND_4_DRUM_MAP)).toBe(DrumVoice.TOM);
      expect(mapNoteToVoice(5, ROCK_BAND_4_DRUM_MAP)).toBe(DrumVoice.HAT);
    });
  });

  describe('groupNotesByVoice', () => {
    it('should group notes by voice category', () => {
      const notes: Array<{type: NoteType}> = [
        {type: 0 as unknown as NoteType},
        {type: 1 as unknown as NoteType},
        {type: 2 as unknown as NoteType},
        {type: 0 as unknown as NoteType},
        {type: 3 as unknown as NoteType},
      ];

      const groups = groupNotesByVoice(notes);

      expect(groups[DrumVoice.KICK]).toHaveLength(2);
      expect(groups[DrumVoice.SNARE]).toHaveLength(1);
      expect(groups[DrumVoice.HAT]).toHaveLength(1);
      expect(groups[DrumVoice.TOM]).toHaveLength(1);
      expect(groups[DrumVoice.CYMBAL]).toHaveLength(0);
      expect(groups[DrumVoice.UNKNOWN]).toHaveLength(0);
    });

    it('should handle empty note array', () => {
      const groups = groupNotesByVoice([]);

      Object.values(groups).forEach(group => {
        expect(group).toHaveLength(0);
      });
    });
  });

  describe('countNotesByVoice', () => {
    it('should count notes by voice category', () => {
      const notes: Array<{type: NoteType}> = [
        {type: 0 as unknown as NoteType},
        {type: 1 as unknown as NoteType},
        {type: 2 as unknown as NoteType},
        {type: 0 as unknown as NoteType},
        {type: 3 as unknown as NoteType},
        {type: 99 as unknown as NoteType},
      ];

      const counts = countNotesByVoice(notes);

      expect(counts[DrumVoice.KICK]).toBe(2);
      expect(counts[DrumVoice.SNARE]).toBe(1);
      expect(counts[DrumVoice.HAT]).toBe(1);
      expect(counts[DrumVoice.TOM]).toBe(1);
      expect(counts[DrumVoice.CYMBAL]).toBe(0);
      expect(counts[DrumVoice.UNKNOWN]).toBe(1);
    });
  });

  describe('getTotalNotesInVoices', () => {
    it('should count total notes in specified voices', () => {
      const notes: Array<{type: NoteType}> = [
        {type: 0 as unknown as NoteType},
        {type: 1 as unknown as NoteType},
        {type: 2 as unknown as NoteType},
        {type: 3 as unknown as NoteType},
        {type: 4 as unknown as NoteType},
      ];

      const tomCount = getTotalNotesInVoices(notes, [DrumVoice.TOM]);
      expect(tomCount).toBe(1);

      const percussionCount = getTotalNotesInVoices(notes, [
        DrumVoice.TOM,
        DrumVoice.CYMBAL,
      ]);
      expect(percussionCount).toBe(2);

      const rhythmCount = getTotalNotesInVoices(notes, [
        DrumVoice.KICK,
        DrumVoice.SNARE,
      ]);
      expect(rhythmCount).toBe(2);
    });
  });

  describe('voice type helpers', () => {
    it('should identify tom notes', () => {
      expect(isTom(3)).toBe(true);
      expect(isTom(5)).toBe(true);
      expect(isTom(0)).toBe(false);
      expect(isTom(1)).toBe(false);
    });

    it('should identify hat notes', () => {
      expect(isHat(2)).toBe(true);
      expect(isHat(0)).toBe(false);
      expect(isHat(1)).toBe(false);
    });

    it('should identify kick notes', () => {
      expect(isKick(0)).toBe(true);
      expect(isKick(1)).toBe(false);
      expect(isKick(2)).toBe(false);
    });

    it('should identify cymbal notes', () => {
      expect(isCymbal(4)).toBe(true);
      expect(isCymbal(0)).toBe(false);
      expect(isCymbal(1)).toBe(false);
    });

    it('should work with custom mappings', () => {
      const customMap = {
        0: DrumVoice.TOM,
        1: DrumVoice.KICK,
      };

      expect(isTom(0, customMap)).toBe(true);
      expect(isKick(1, customMap)).toBe(true);
      expect(isKick(0, customMap)).toBe(false);
    });
  });

  describe('drum mapping constants', () => {
    it('should have valid Clone Hero mapping', () => {
      expect(CLONE_HERO_DRUM_MAP[0]).toBe(DrumVoice.KICK);
      expect(CLONE_HERO_DRUM_MAP[1]).toBe(DrumVoice.SNARE);
      expect(CLONE_HERO_DRUM_MAP[2]).toBe(DrumVoice.HAT);
      expect(CLONE_HERO_DRUM_MAP[3]).toBe(DrumVoice.TOM);
      expect(CLONE_HERO_DRUM_MAP[4]).toBe(DrumVoice.CYMBAL);
      expect(CLONE_HERO_DRUM_MAP[5]).toBe(DrumVoice.TOM);
    });

    it('should have valid Rock Band 4 mapping', () => {
      expect(ROCK_BAND_4_DRUM_MAP[0]).toBe(DrumVoice.KICK);
      expect(ROCK_BAND_4_DRUM_MAP[1]).toBe(DrumVoice.SNARE);
      expect(ROCK_BAND_4_DRUM_MAP[2]).toBe(DrumVoice.TOM);
      expect(ROCK_BAND_4_DRUM_MAP[3]).toBe(DrumVoice.TOM);
      expect(ROCK_BAND_4_DRUM_MAP[4]).toBe(DrumVoice.CYMBAL);
      expect(ROCK_BAND_4_DRUM_MAP[5]).toBe(DrumVoice.HAT);
    });
  });

  describe('Fixture-based validation', () => {
    function assertMappingForNote(type: number, flags: number): void {
      // Validate lane/flag mapping semantics using scan-chart runtime enums
      if (type === noteTypes.kick) {
        expect(
          mapScanChartNoteToVoice(type as unknown as NoteType, null, flags),
        ).toBe(DrumVoice.KICK);
      } else if (type === noteTypes.redDrum) {
        expect(
          mapScanChartNoteToVoice(type as unknown as NoteType, null, flags),
        ).toBe(DrumVoice.SNARE);
      } else if (type === noteTypes.yellowDrum) {
        const expected =
          flags & noteFlags.cymbal ? DrumVoice.HAT : DrumVoice.TOM;
        expect(
          mapScanChartNoteToVoice(type as unknown as NoteType, null, flags),
        ).toBe(expected);
      } else if (type === noteTypes.blueDrum) {
        const expected =
          flags & noteFlags.cymbal ? DrumVoice.CYMBAL : DrumVoice.TOM;
        expect(
          mapScanChartNoteToVoice(type as unknown as NoteType, null, flags),
        ).toBe(expected);
      } else if (type === noteTypes.greenDrum) {
        const expected =
          flags & noteFlags.cymbal ? DrumVoice.CYMBAL : DrumVoice.TOM;
        expect(
          mapScanChartNoteToVoice(type as unknown as NoteType, null, flags),
        ).toBe(expected);
      } else {
        // For any other types present, mapping should not produce UNKNOWN in drum tracks
        expect(
          mapScanChartNoteToVoice(type as unknown as NoteType, null, flags),
        ).not.toBe(DrumVoice.UNKNOWN);
      }
    }

    it('maps all drum notes correctly in When I Come Around fixture', async () => {
      const fixtureData = await import(
        './__fixtures__/When I Come Around - Green Day.json'
      );
      const chart = fixtureData.default;
      const drumTrack = chart.trackData.find(
        (t: any) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      if (!drumTrack) throw new Error('No expert drum track found');

      const allNotes = drumTrack.noteEventGroups.flat();
      const drumType = (chart.drumType ?? null) as 0 | 1 | 2 | null;

      // No UNKNOWN voices should appear
      const unknowns = allNotes.filter(
        (n: any) =>
          mapScanChartNoteToVoice(n.type, drumType, n.flags ?? 0) ===
          DrumVoice.UNKNOWN,
      );
      expect(unknowns.length).toBe(0);

      // Validate mapping semantics for each note
      for (const note of allNotes) {
        assertMappingForNote(note.type, note.flags ?? 0);
      }
    });

    it('maps all drum notes correctly in Downfall Of Us All fixture', async () => {
      const fixtureData = await import(
        './__fixtures__/Downfall Of Us All - A Day To Remember.json'
      );
      const chart = fixtureData.default;
      const drumTrack = chart.trackData.find(
        (t: any) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      if (!drumTrack) throw new Error('No expert drum track found');

      const allNotes = drumTrack.noteEventGroups.flat();
      const drumType = (chart.drumType ?? null) as 0 | 1 | 2 | null;

      const unknowns = allNotes.filter(
        (n: any) =>
          mapScanChartNoteToVoice(n.type, drumType, n.flags ?? 0) ===
          DrumVoice.UNKNOWN,
      );
      expect(unknowns.length).toBe(0);

      for (const note of allNotes) {
        assertMappingForNote(note.type, note.flags ?? 0);
      }
    });
  });
});
