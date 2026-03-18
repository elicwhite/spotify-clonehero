/**
 * Note number mapping functions for .chart drum serialization.
 *
 * Maps our ergonomic DrumNoteType/DrumNoteFlags to .chart note numbers.
 * Reference: lib/fill-detector/drumLaneMap.ts for scan-chart type mappings.
 *
 * .chart note number reference:
 *   0  = Kick           32 = Double kick (Expert+)
 *   1  = Red (snare)    34-37 = Accent (red, yellow, blue, green)
 *   2  = Yellow         40-43 = Ghost  (red, yellow, blue, green)
 *   3  = Blue           66 = Yellow cymbal marker
 *   4  = Green          67 = Blue cymbal marker
 *                       68 = Green cymbal marker
 */

import type {DrumNoteType, DrumNoteFlags} from './types';
import {noteTypes} from '@eliwhite/scan-chart';
import type {NoteType} from '@eliwhite/scan-chart';

/**
 * Map a DrumNoteType to its base .chart note number.
 * Double kick always emits note 0 (the note 32 marker is added separately).
 */
export function drumTypeToNoteNumber(
  type: DrumNoteType,
  _flags: DrumNoteFlags,
): number {
  switch (type) {
    case 'kick':
      return 0;
    case 'red':
      return 1;
    case 'yellow':
      return 2;
    case 'blue':
      return 3;
    case 'green':
      return 4;
  }
}

/**
 * Map a DrumNoteType to its pro drums cymbal marker note number.
 * Returns null for types that have no cymbal marker (kick, red).
 */
export function drumTypeToCymbalNumber(type: DrumNoteType): number | null {
  switch (type) {
    case 'yellow':
      return 66;
    case 'blue':
      return 67;
    case 'green':
      return 68;
    default:
      return null;
  }
}

/**
 * Map a DrumNoteType to its accent modifier note number.
 * Returns null for kick (no accent modifier in .chart format).
 */
export function drumTypeToAccentNumber(type: DrumNoteType): number | null {
  switch (type) {
    case 'red':
      return 34;
    case 'yellow':
      return 35;
    case 'blue':
      return 36;
    case 'green':
      return 37;
    default:
      return null;
  }
}

/**
 * Map a DrumNoteType to its ghost modifier note number.
 * Returns null for kick (no ghost modifier in .chart format).
 */
export function drumTypeToGhostNumber(type: DrumNoteType): number | null {
  switch (type) {
    case 'red':
      return 40;
    case 'yellow':
      return 41;
    case 'blue':
      return 42;
    case 'green':
      return 43;
    default:
      return null;
  }
}

/**
 * Convert our DrumNoteType to scan-chart's numeric NoteType.
 * Used for comparing round-trip test results.
 */
export function drumNoteTypeToScanChartType(type: DrumNoteType): NoteType {
  switch (type) {
    case 'kick':
      return noteTypes.kick;
    case 'red':
      return noteTypes.redDrum;
    case 'yellow':
      return noteTypes.yellowDrum;
    case 'blue':
      return noteTypes.blueDrum;
    case 'green':
      return noteTypes.greenDrum;
  }
}
