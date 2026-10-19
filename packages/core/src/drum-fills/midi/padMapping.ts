/**
 * MIDI note number → Clone Hero drum lane resolution.
 *
 * A Clone Hero MIDI profile assigns physical pads/cymbals to named slots
 * (Red Pad, Yellow Cymbal, …). This module turns a profile into a lookup from
 * incoming MIDI note numbers to the Clone Hero lane + cymbal classification
 * used by the scoring engine. Lanes line up with scan-chart `noteTypes`:
 *
 *   kick → 13, red → 14, yellow → 15, blue → 16, green → 17
 *
 * Cymbal semantics match `lib/chart-edit/helpers/drum-notes.ts`: only the
 * yellow / blue / green lanes can be cymbals; red and kick are never cymbals.
 */

import type {ChProfile, ChPadName} from './chProfile';

/** Clone Hero drum lanes. */
export type DrumLane = 'kick' | 'red' | 'yellow' | 'blue' | 'green';

/** scan-chart NoteType values for drum lanes. */
export const LANE_NOTE_TYPES: Record<DrumLane, number> = {
  kick: 13,
  red: 14,
  yellow: 15,
  blue: 16,
  green: 17,
};

/** Resolution of a single MIDI note number to a Clone Hero pad. */
export interface PadResolution {
  lane: DrumLane;
  /** True for cymbal hits (yellow/blue/green cymbals); false for toms/snare/kick. */
  isCymbal: boolean;
  /** scan-chart NoteType for the lane. */
  noteType: number;
}

const PAD_NAME_TO_RESOLUTION: Record<
  ChPadName,
  {lane: DrumLane; isCymbal: boolean}
> = {
  'Kick Pad': {lane: 'kick', isCymbal: false},
  'Red Pad': {lane: 'red', isCymbal: false},
  'Yellow Pad': {lane: 'yellow', isCymbal: false},
  'Blue Pad': {lane: 'blue', isCymbal: false},
  'Green Pad': {lane: 'green', isCymbal: false},
  'Yellow Cymbal': {lane: 'yellow', isCymbal: true},
  'Blue Cymbal': {lane: 'blue', isCymbal: true},
  'Green Cymbal': {lane: 'green', isCymbal: true},
};

/**
 * A reusable MIDI-note → pad lookup built from a profile.
 *
 * If a note number is assigned to more than one pad in the profile, the first
 * assignment wins (profiles are not expected to contain conflicts).
 */
export class PadMapping {
  private readonly byNote: Map<number, PadResolution>;

  constructor(profile: ChProfile) {
    this.byNote = new Map();
    for (const padName of Object.keys(PAD_NAME_TO_RESOLUTION) as ChPadName[]) {
      const assignments = profile.mappings[padName];
      if (!assignments) continue;
      const {lane, isCymbal} = PAD_NAME_TO_RESOLUTION[padName];
      const resolution: PadResolution = {
        lane,
        isCymbal,
        noteType: LANE_NOTE_TYPES[lane],
      };
      for (const {noteNumber} of assignments) {
        if (!this.byNote.has(noteNumber)) {
          this.byNote.set(noteNumber, resolution);
        }
      }
    }
  }

  /** Resolve a MIDI note number, or `null` if it is not mapped. */
  resolve(noteNumber: number): PadResolution | null {
    return this.byNote.get(noteNumber) ?? null;
  }

  /** Every MIDI note number known to this mapping. */
  knownNotes(): number[] {
    return [...this.byNote.keys()];
  }
}

/** Convenience: resolve a single note number against a profile. */
export function resolvePad(
  profile: ChProfile,
  noteNumber: number,
): PadResolution | null {
  return new PadMapping(profile).resolve(noteNumber);
}
