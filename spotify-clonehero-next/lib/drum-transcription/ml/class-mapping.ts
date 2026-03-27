/**
 * Map CRNN model output classes to Clone Hero chart notes.
 *
 * The CRNN outputs 9 instrument classes. This module maps them to the 5-lane
 * chart note types and cymbal markers used in .chart files (pro drums):
 *
 *   | CRNN Class | Chart Note | Cymbal Marker | DrumNoteType |
 *   |------------|-----------|---------------|--------------|
 *   | BD (kick)  | 0 (kick)  | --            | kick         |
 *   | SD (snare) | 1 (red)   | --            | red          |
 *   | HT (hi-tom)| 2 (yellow)| --            | yellow       |
 *   | MT (mid-tom)| 3 (blue) | --            | blue         |
 *   | FT (floor-tom)| 4 (green)| --          | green        |
 *   | HH (hihat) | 2 (yellow)| 66            | yellow       |
 *   | CR (crash) | 4 (green) | 68            | green        |
 *   | CR2 (crash2)| 3 (blue) | 67            | blue         |
 *   | RD (ride)  | 3 (blue)  | 67            | blue         |
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
import type {RawDrumEvent, DrumClassName} from './types';

// ---------------------------------------------------------------------------
// CRNN class -> chart note mapping
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

/** Map from CRNN class name to chart note properties. */
const CLASS_TO_CHART: Record<DrumClassName, ChartNoteMapping> = {
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
  HT: {
    noteType: 'yellow',
    noteNumber: 2,
    cymbalMarker: null,
    isCymbal: false,
  },
  MT: {
    noteType: 'blue',
    noteNumber: 3,
    cymbalMarker: null,
    isCymbal: false,
  },
  FT: {
    noteType: 'green',
    noteNumber: 4,
    cymbalMarker: null,
    isCymbal: false,
  },
  HH: {
    noteType: 'yellow',
    noteNumber: 2,
    cymbalMarker: 66,
    isCymbal: true,
  },
  CR: {
    noteType: 'green',
    noteNumber: 4,
    cymbalMarker: 68,
    isCymbal: true,
  },
  CR2: {
    noteType: 'blue',
    noteNumber: 3,
    cymbalMarker: 67,
    isCymbal: true,
  },
  RD: {
    noteType: 'blue',
    noteNumber: 3,
    cymbalMarker: 67,
    isCymbal: true,
  },
};

/**
 * Get the chart note mapping for a drum class.
 */
export function getChartMapping(drumClass: DrumClassName): ChartNoteMapping {
  return CLASS_TO_CHART[drumClass];
}

/**
 * Get the .chart note number for a drum class.
 */
export function drumClassToNoteNumber(drumClass: DrumClassName): number {
  return CLASS_TO_CHART[drumClass].noteNumber;
}

/**
 * Get the cymbal marker for a drum class (or null if not a cymbal).
 */
export function drumClassToCymbalMarker(
  drumClass: DrumClassName,
): number | null {
  return CLASS_TO_CHART[drumClass].cymbalMarker;
}

/**
 * Get the DrumNoteType for a drum class.
 */
export function drumClassToDrumNoteType(
  drumClass: DrumClassName,
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
