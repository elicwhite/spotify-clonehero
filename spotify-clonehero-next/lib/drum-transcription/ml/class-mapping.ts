/**
 * Map ADTOF model output classes to Clone Hero chart notes.
 *
 * ADTOF outputs 5 classes. This module maps them to the chart note types
 * and cymbal markers used in .chart files:
 *
 *   | ADTOF Class | Chart Note | Cymbal Marker | DrumNoteType |
 *   |-------------|-----------|---------------|--------------|
 *   | BD (35)     | 0 (kick)  | --            | kick         |
 *   | SD (38)     | 1 (red)   | --            | red          |
 *   | HH (42)     | 2 (yellow)| 66            | yellow       |
 *   | TT (47)     | 3 (blue)  | --            | blue         |
 *   | CY+RD (49)  | 4 (green) | 68            | green        |
 *
 * Uses chart-io types (DrumNote, DrumNoteType, DrumNoteFlags) and timing
 * utilities (msToTick, buildTimedTempos) from the chart-io module.
 */

import type {
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
  TempoEvent,
  TimedTempo,
} from '../chart-io/types';
import {buildTimedTempos, msToTick} from '../chart-io/timing';
import type {RawDrumEvent, AdtofClassName} from './types';

// ---------------------------------------------------------------------------
// ADTOF class -> chart note mapping
// ---------------------------------------------------------------------------

interface ChartNoteMapping {
  /** DrumNoteType for the chart. */
  noteType: DrumNoteType;
  /** .chart note number (0-4). */
  noteNumber: number;
  /** Pro drums cymbal marker (66, 67, 68) or null. */
  cymbalMarker: number | null;
  /** Whether the cymbal flag should be set. */
  isCymbal: boolean;
}

/** Map from ADTOF class name to chart note properties. */
const CLASS_TO_CHART: Record<AdtofClassName, ChartNoteMapping> = {
  BD: {
    noteType: 'kick',
    noteNumber: 0,
    cymbalMarker: null,
    isCymbal: false,
  },
  SD: {
    noteType: 'red',
    noteNumber: 1,
    cymbalMarker: null,
    isCymbal: false,
  },
  HH: {
    noteType: 'yellow',
    noteNumber: 2,
    cymbalMarker: 66,
    isCymbal: true,
  },
  TT: {
    noteType: 'blue',
    noteNumber: 3,
    cymbalMarker: null,
    isCymbal: false,
  },
  'CY+RD': {
    noteType: 'green',
    noteNumber: 4,
    cymbalMarker: 68,
    isCymbal: true,
  },
};

/**
 * Get the chart note mapping for an ADTOF class.
 */
export function getChartMapping(drumClass: AdtofClassName): ChartNoteMapping {
  return CLASS_TO_CHART[drumClass];
}

/**
 * Get the .chart note number for an ADTOF class.
 */
export function adtofClassToNoteNumber(drumClass: AdtofClassName): number {
  return CLASS_TO_CHART[drumClass].noteNumber;
}

/**
 * Get the cymbal marker for an ADTOF class (or null if not a cymbal).
 */
export function adtofClassToCymbalMarker(
  drumClass: AdtofClassName,
): number | null {
  return CLASS_TO_CHART[drumClass].cymbalMarker;
}

/**
 * Get the DrumNoteType for an ADTOF class.
 */
export function adtofClassToDrumNoteType(
  drumClass: AdtofClassName,
): DrumNoteType {
  return CLASS_TO_CHART[drumClass].noteType;
}

// ---------------------------------------------------------------------------
// Conversion: RawDrumEvent[] -> DrumNote[]
// ---------------------------------------------------------------------------

/**
 * Convert an array of RawDrumEvents to DrumNote[] for chart writing.
 *
 * Uses the tempo map to convert seconds -> ticks via msToTick.
 *
 * @param events - Raw drum events from peak picking.
 * @param tempos - Tempo events from the chart document.
 * @param resolution - Ticks per quarter note (e.g. 480).
 * @returns Array of DrumNote sorted by tick.
 */
export function rawEventsToDrumNotes(
  events: RawDrumEvent[],
  tempos: TempoEvent[],
  resolution: number,
): DrumNote[] {
  const timedTempos: TimedTempo[] = buildTimedTempos(tempos, resolution);

  const notes: DrumNote[] = events.map((event) => {
    const mapping = CLASS_TO_CHART[event.drumClass];
    const msTime = event.timeSeconds * 1000;
    const tick = msToTick(msTime, timedTempos, resolution);

    const flags: DrumNoteFlags = {};
    if (mapping.isCymbal) {
      flags.cymbal = true;
    }

    return {
      tick,
      type: mapping.noteType,
      length: 0, // Drums are always non-sustained
      flags,
    };
  });

  // Sort by tick, then by note type for stability
  notes.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return noteTypeOrder(a.type) - noteTypeOrder(b.type);
  });

  return notes;
}

/**
 * Order for sorting notes at the same tick.
 */
function noteTypeOrder(type: DrumNoteType): number {
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

// ---------------------------------------------------------------------------
// Conversion: RawDrumEvent[] -> EditorDrumEvent[]
// ---------------------------------------------------------------------------

/**
 * Convert RawDrumEvents to EditorDrumEvents for the web editor.
 *
 * Each event gets a unique ID, tick position, and editor metadata.
 *
 * @param events - Raw drum events from peak picking.
 * @param tempos - Tempo events from the chart document.
 * @param resolution - Ticks per quarter note (e.g. 480).
 * @returns Array of EditorDrumEvent sorted by tick.
 */
export function rawEventsToEditorEvents(
  events: RawDrumEvent[],
  tempos: TempoEvent[],
  resolution: number,
): import('./types').EditorDrumEvent[] {
  const timedTempos: TimedTempo[] = buildTimedTempos(tempos, resolution);

  const editorEvents: import('./types').EditorDrumEvent[] = events.map(
    (event, index) => {
      const mapping = CLASS_TO_CHART[event.drumClass];
      const msTime = event.timeSeconds * 1000;
      const tick = msToTick(msTime, timedTempos, resolution);

      return {
        id: `model-${index}-${event.drumClass}-${tick}`,
        tick,
        msTime,
        noteNumber: mapping.noteNumber,
        cymbalMarker: mapping.cymbalMarker,
        modelClass: event.drumClass,
        confidence: event.confidence,
        reviewed: false,
        source: 'model' as const,
      };
    },
  );

  // Sort by tick
  editorEvents.sort((a, b) => a.tick - b.tick);

  return editorEvents;
}
