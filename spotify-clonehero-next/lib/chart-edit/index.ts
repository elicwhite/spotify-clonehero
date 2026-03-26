/**
 * chart-edit public API
 *
 * Read, create, and write Clone Hero chart documents.
 * All scan-chart types are re-exported for consumer convenience.
 */

// Core functions
export { readChart } from './reader';
export { createChart } from './create';
export { writeChart } from './writer';

// Types
export type {
  ChartDocument,
  ChartMetadata,
  FileEntry,
  TrackData,
  TrackEvent,
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
  EventType,
  Instrument,
  Difficulty,
} from './types';

// Constants
export { eventTypes, instruments, difficulties } from './types';

// Type mappings
export {
  drumNoteEventType,
  eventTypeToDrumNote,
  drumCymbalEventType,
  drumTomEventType,
  drumAccentEventType,
  drumGhostEventType,
  baseDrumEventTypes,
  drumModifierEventTypes,
} from './types';

// Drum helpers
export {
  addDrumNote,
  removeDrumNote,
  getDrumNotes,
  setDrumNoteFlags,
} from './helpers/drum-notes';

// Section helpers
export {
  addStarPower,
  removeStarPower,
  addActivationLane,
  removeActivationLane,
  addSoloSection,
  removeSoloSection,
  addFlexLane,
  removeFlexLane,
} from './helpers/drum-sections';

// Tempo helpers
export {
  addTempo,
  removeTempo,
  addTimeSignature,
  removeTimeSignature,
} from './helpers/tempo';

// Section helpers
export {
  addSection,
  removeSection,
} from './helpers/sections';
