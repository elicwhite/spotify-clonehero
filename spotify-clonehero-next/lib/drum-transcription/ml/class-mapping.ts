/**
 * Map CRNN model output classes to Clone Hero chart notes.
 *
 * The CRNN outputs 9 instrument classes. This module maps them to the 5-lane
 * chart note types and cymbal markers used in .chart files (pro drums):
 *
 *   | CRNN Class | Chart Note | Cymbal Marker | DrumNoteType  |
 *   |------------|-----------|---------------|---------------|
 *   | BD (kick)  | 0 (kick)  | --            | kick          |
 *   | SD (snare) | 1 (red)   | --            | redDrum       |
 *   | HT (hi-tom)| 2 (yellow)| --            | yellowDrum    |
 *   | MT (mid-tom)| 3 (blue) | --            | blueDrum      |
 *   | FT (floor-tom)| 4 (green)| --          | greenDrum     |
 *   | HH (hihat) | 2 (yellow)| 66            | yellowDrum    |
 *   | CR (crash) | 4 (green) | 68            | greenDrum     |
 *   | CR2 (crash2)| 3 (blue) | 67            | blueDrum      |
 *   | RD (ride)  | 3 (blue)  | 67            | blueDrum      |
 *
 * Uses chart-edit types (DrumNote, DrumNoteType, DrumNoteFlags) via
 * chart-types, and timing utilities (msToTick, buildTimedTempos) from timing.
 */

import type {
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
  TimedTempo,
} from '../chart-types';
import {buildTimedTempos, msToTick} from '../timing';
import type {RawDrumEvent, DrumClassName} from './types';

// ---------------------------------------------------------------------------
// CRNN class -> chart note mapping
// ---------------------------------------------------------------------------

/**
 * Grid-quantizer policy for a lane.
 *
 *   - `candidate`: snap to the nearest musical subdivision (16th / 16th-triplet)
 *     via the shared candidate scorer.
 *
 * ALL lanes use `candidate` (the deployed behavior). A per-lane `uniform`
 * carve-out (1/24-beat "naive" snap for crash/crash-2/ride) was trialled but
 * DROPPED 2026-07-04: (1) it was a WASH on the corrected shipping grid (val-B
 * edit-rate −0.0003, CI incl 0), and (2) because chart-builder snaps each note
 * independently, giving cymbals a different grid function SPLIT chords — a
 * same-onset floor-tom + crash (both greenDrum) snapped to different ticks and
 * defeated the cross-class dedup, rendering two same-pad gems ~21ms apart. A
 * single grid function keeps every note at one onset on one tick (chords stay
 * whole). The `uniform` member and its snapTickUniform implementation were
 * removed (drum-to-chart plan §4 step 5, R5-3) now that this dead-since-2026-
 * 07-04 branch is confirmed unreachable (no lane maps to it). The field is
 * retained (narrowed to `candidate`) so a future GROUP-level policy (decide
 * one mode per onset group) can be added without splitting chords.
 */
export type SnapMode = 'candidate';

interface ChartNoteMapping {
  /** DrumNoteType for the chart. */
  noteType: DrumNoteType;
  /** .chart note number (0-4). */
  noteNumber: number;
  /** Pro drums cymbal marker (66, 67, 68) or null. */
  cymbalMarker: number | null;
  /** Whether the cymbal flag should be set. */
  isCymbal: boolean;
  /** Grid-quantizer policy for this lane (see {@link SnapMode}). */
  snapMode: SnapMode;
}

/** Map from CRNN class name to chart note properties. */
const CLASS_TO_CHART: Record<DrumClassName, ChartNoteMapping> = {
  BD: {
    noteType: 'kick',
    noteNumber: 0,
    cymbalMarker: null,
    isCymbal: false,
    snapMode: 'candidate',
  },
  SD: {
    noteType: 'redDrum',
    noteNumber: 1,
    cymbalMarker: null,
    isCymbal: false,
    snapMode: 'candidate',
  },
  HT: {
    noteType: 'yellowDrum',
    noteNumber: 2,
    cymbalMarker: null,
    isCymbal: false,
    snapMode: 'candidate',
  },
  MT: {
    noteType: 'blueDrum',
    noteNumber: 3,
    cymbalMarker: null,
    isCymbal: false,
    snapMode: 'candidate',
  },
  FT: {
    noteType: 'greenDrum',
    noteNumber: 4,
    cymbalMarker: null,
    isCymbal: false,
    snapMode: 'candidate',
  },
  HH: {
    noteType: 'yellowDrum',
    noteNumber: 2,
    cymbalMarker: 66,
    isCymbal: true,
    snapMode: 'candidate',
  },
  // crash/crash-2/ride: candidate like every other lane — see SnapMode (the
  // uniform carve-out was dropped; a per-lane split rendered chords apart).
  CR: {
    noteType: 'greenDrum',
    noteNumber: 4,
    cymbalMarker: 68,
    isCymbal: true,
    snapMode: 'candidate',
  },
  CR2: {
    noteType: 'blueDrum',
    noteNumber: 3,
    cymbalMarker: 67,
    isCymbal: true,
    snapMode: 'candidate',
  },
  RD: {
    noteType: 'blueDrum',
    noteNumber: 3,
    cymbalMarker: 67,
    isCymbal: true,
    snapMode: 'candidate',
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
 * @param tempos - Tempo events from the chart document (tick + beatsPerMinute).
 * @param resolution - Ticks per quarter note (e.g. 480).
 * @returns Array of DrumNote sorted by tick.
 */
export function rawEventsToDrumNotes(
  events: RawDrumEvent[],
  tempos: {tick: number; beatsPerMinute: number}[],
  resolution: number,
): DrumNote[] {
  const timedTempos: TimedTempo[] = buildTimedTempos(tempos, resolution);

  const notes: DrumNote[] = events.map(event => {
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
    case 'redDrum':
      return 1;
    case 'yellowDrum':
      return 2;
    case 'blueDrum':
      return 3;
    case 'greenDrum':
      return 4;
    case 'fiveGreenDrum':
      return 5;
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
 * @param tempos - Tempo events from the chart document (tick + beatsPerMinute).
 * @param resolution - Ticks per quarter note (e.g. 480).
 * @returns Array of EditorDrumEvent sorted by tick.
 */
export function rawEventsToEditorEvents(
  events: RawDrumEvent[],
  tempos: {tick: number; beatsPerMinute: number}[],
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
