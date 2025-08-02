/**
 * Helpers to map NoteType to voice categories for drum analysis
 */

import { NoteType, DrumVoice } from './types.js';

// Re-export DrumVoice for use in other modules
export { DrumVoice };

/**
 * Clone Hero standard drum lane mapping
 * Based on typical 5-lane CH drum charts
 */
export const CLONE_HERO_DRUM_MAP: Record<number, DrumVoice> = {
  0: DrumVoice.KICK,     // Kick drum
  1: DrumVoice.SNARE,    // Red pad - Snare
  2: DrumVoice.HAT,      // Yellow pad - Hi-Hat/Ride
  3: DrumVoice.TOM,      // Blue pad - Tom/Ride
  4: DrumVoice.CYMBAL,   // Orange pad - Cymbal/Crash
  5: DrumVoice.TOM,      // Green pad - Tom (if present)
};

/**
 * Rock Band 4 drum lane mapping
 * Different lane assignments than Clone Hero
 */
export const ROCK_BAND_4_DRUM_MAP: Record<number, DrumVoice> = {
  0: DrumVoice.KICK,     // Kick drum
  1: DrumVoice.SNARE,    // Red pad - Snare
  2: DrumVoice.TOM,      // Yellow pad - Hi-Tom
  3: DrumVoice.TOM,      // Blue pad - Low-Tom
  4: DrumVoice.CYMBAL,   // Orange pad - Crash
  5: DrumVoice.HAT,      // Green pad - Hi-Hat (if present)
};

/**
 * Default mapping - uses Clone Hero convention
 */
const DEFAULT_DRUM_MAP = CLONE_HERO_DRUM_MAP;

/**
 * Maps a NoteType to its corresponding drum voice category
 */
export function mapNoteToVoice(noteType: NoteType, customMap?: Record<number, DrumVoice>): DrumVoice {
  const drumMap = customMap || DEFAULT_DRUM_MAP;
  return drumMap[noteType] || DrumVoice.UNKNOWN;
}

/**
 * Groups notes by their voice categories
 */
export function groupNotesByVoice(
  notes: { type: NoteType }[], 
  customMap?: Record<number, DrumVoice>
): Record<DrumVoice, { type: NoteType }[]> {
  const groups: Record<DrumVoice, { type: NoteType }[]> = {
    [DrumVoice.KICK]: [],
    [DrumVoice.SNARE]: [],
    [DrumVoice.HAT]: [],
    [DrumVoice.TOM]: [],
    [DrumVoice.CYMBAL]: [],
    [DrumVoice.UNKNOWN]: [],
  };

  for (const note of notes) {
    const voice = mapNoteToVoice(note.type, customMap);
    groups[voice].push(note);
  }

  return groups;
}

/**
 * Counts notes by voice category
 */
export function countNotesByVoice(
  notes: { type: NoteType }[], 
  customMap?: Record<number, DrumVoice>
): Record<DrumVoice, number> {
  const groups = groupNotesByVoice(notes, customMap);
  
  return {
    [DrumVoice.KICK]: groups[DrumVoice.KICK].length,
    [DrumVoice.SNARE]: groups[DrumVoice.SNARE].length,
    [DrumVoice.HAT]: groups[DrumVoice.HAT].length,
    [DrumVoice.TOM]: groups[DrumVoice.TOM].length,
    [DrumVoice.CYMBAL]: groups[DrumVoice.CYMBAL].length,
    [DrumVoice.UNKNOWN]: groups[DrumVoice.UNKNOWN].length,
  };
}

/**
 * Gets total count of notes for specific voice categories
 */
export function getTotalNotesInVoices(
  notes: { type: NoteType }[], 
  voices: DrumVoice[], 
  customMap?: Record<number, DrumVoice>
): number {
  const counts = countNotesByVoice(notes, customMap);
  return voices.reduce((total, voice) => total + counts[voice], 0);
}

/**
 * Helper to check if a note type represents a tom
 */
export function isTom(noteType: NoteType, customMap?: Record<number, DrumVoice>): boolean {
  return mapNoteToVoice(noteType, customMap) === DrumVoice.TOM;
}

/**
 * Helper to check if a note type represents a hat/ride
 */
export function isHat(noteType: NoteType, customMap?: Record<number, DrumVoice>): boolean {
  return mapNoteToVoice(noteType, customMap) === DrumVoice.HAT;
}

/**
 * Helper to check if a note type represents a kick
 */
export function isKick(noteType: NoteType, customMap?: Record<number, DrumVoice>): boolean {
  return mapNoteToVoice(noteType, customMap) === DrumVoice.KICK;
}

/**
 * Helper to check if a note type represents a cymbal/crash
 */
export function isCymbal(noteType: NoteType, customMap?: Record<number, DrumVoice>): boolean {
  return mapNoteToVoice(noteType, customMap) === DrumVoice.CYMBAL;
}