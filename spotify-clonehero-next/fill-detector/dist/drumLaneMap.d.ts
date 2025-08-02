/**
 * Helpers to map NoteType to voice categories for drum analysis
 */
import { NoteType, DrumVoice } from './types.js';
export { DrumVoice };
/**
 * Clone Hero standard drum lane mapping
 * Based on typical 5-lane CH drum charts
 */
export declare const CLONE_HERO_DRUM_MAP: Record<number, DrumVoice>;
/**
 * Rock Band 4 drum lane mapping
 * Different lane assignments than Clone Hero
 */
export declare const ROCK_BAND_4_DRUM_MAP: Record<number, DrumVoice>;
/**
 * Maps a NoteType to its corresponding drum voice category
 */
export declare function mapNoteToVoice(noteType: NoteType, customMap?: Record<number, DrumVoice>): DrumVoice;
/**
 * Groups notes by their voice categories
 */
export declare function groupNotesByVoice(notes: {
    type: NoteType;
}[], customMap?: Record<number, DrumVoice>): Record<DrumVoice, {
    type: NoteType;
}[]>;
/**
 * Counts notes by voice category
 */
export declare function countNotesByVoice(notes: {
    type: NoteType;
}[], customMap?: Record<number, DrumVoice>): Record<DrumVoice, number>;
/**
 * Gets total count of notes for specific voice categories
 */
export declare function getTotalNotesInVoices(notes: {
    type: NoteType;
}[], voices: DrumVoice[], customMap?: Record<number, DrumVoice>): number;
/**
 * Helper to check if a note type represents a tom
 */
export declare function isTom(noteType: NoteType, customMap?: Record<number, DrumVoice>): boolean;
/**
 * Helper to check if a note type represents a hat/ride
 */
export declare function isHat(noteType: NoteType, customMap?: Record<number, DrumVoice>): boolean;
/**
 * Helper to check if a note type represents a kick
 */
export declare function isKick(noteType: NoteType, customMap?: Record<number, DrumVoice>): boolean;
/**
 * Helper to check if a note type represents a cymbal/crash
 */
export declare function isCymbal(noteType: NoteType, customMap?: Record<number, DrumVoice>): boolean;
//# sourceMappingURL=drumLaneMap.d.ts.map