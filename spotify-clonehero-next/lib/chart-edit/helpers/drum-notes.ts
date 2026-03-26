/**
 * Drum note helper functions.
 *
 * Translates between friendly DrumNote types and raw scan-chart
 * trackEvents on a TrackData object. All mutations are in-place.
 */

import type {
  TrackData,
  DrumNoteType,
  DrumNoteFlags,
  DrumNote,
  TrackEvent,
  EventType,
} from '../types';
import {
  eventTypes,
  drumNoteEventType,
  eventTypeToDrumNote,
  drumCymbalEventType,
  drumTomEventType,
  drumAccentEventType,
  drumGhostEventType,
  baseDrumEventTypes,
  drumModifierEventTypes,
} from '../types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Get all modifier EventTypes that can apply to a given DrumNoteType.
 * Used when removing a note or clearing its modifiers.
 */
function getModifierTypesForNote(type: DrumNoteType): Set<EventType> {
  const modifiers = new Set<EventType>();

  const cymbal = drumCymbalEventType[type];
  if (cymbal !== undefined) modifiers.add(cymbal);

  const tom = drumTomEventType[type];
  if (tom !== undefined) modifiers.add(tom);

  const accent = drumAccentEventType[type];
  if (accent !== undefined) modifiers.add(accent);

  const ghost = drumGhostEventType[type];
  if (ghost !== undefined) modifiers.add(ghost);

  // forceFlam is shared across all notes at a tick — handled separately
  // in removeDrumNote and setDrumNoteFlags to avoid corrupting other notes.

  // kick2x only applies to kick
  if (type === 'kick') {
    modifiers.add(eventTypes.kick2x);
  }

  return modifiers;
}

/**
 * Add a single track event. Does not check for duplicates.
 */
function pushEvent(track: TrackData, tick: number, length: number, type: EventType): void {
  track.trackEvents.push({ tick, length, type });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a drum note with optional flags to a track.
 *
 * Inserts the base note event and any modifier events implied by the flags.
 */
export function addDrumNote(
  track: TrackData,
  note: {
    tick: number;
    type: DrumNoteType;
    length?: number;
    flags?: DrumNoteFlags;
  },
): void {
  const { tick, type, length = 0, flags = {} } = note;

  // Base note event
  pushEvent(track, tick, length, drumNoteEventType[type]);

  // Cymbal marker (only yellow/blue/green have cymbal variants)
  if (flags.cymbal) {
    const cymbalType = drumCymbalEventType[type];
    if (cymbalType !== undefined) {
      pushEvent(track, tick, 0, cymbalType);
    }
  }

  // Double kick (kick only)
  if (flags.doubleKick && type === 'kick') {
    pushEvent(track, tick, 0, eventTypes.kick2x);
  }

  // Accent
  if (flags.accent) {
    const accentType = drumAccentEventType[type];
    if (accentType !== undefined) {
      pushEvent(track, tick, 0, accentType);
    }
  }

  // Ghost
  if (flags.ghost) {
    const ghostType = drumGhostEventType[type];
    if (ghostType !== undefined) {
      pushEvent(track, tick, 0, ghostType);
    }
  }

  // Flam (shared across all notes at this tick — only add if not already present)
  if (flags.flam) {
    const flamExists = track.trackEvents.some(
      (e) => e.tick === tick && e.type === eventTypes.forceFlam,
    );
    if (!flamExists) {
      pushEvent(track, tick, 0, eventTypes.forceFlam);
    }
  }
}

/**
 * Remove a drum note and all its modifier events at a given tick.
 */
export function removeDrumNote(
  track: TrackData,
  tick: number,
  type: DrumNoteType,
): void {
  const baseType = drumNoteEventType[type];
  const modifierTypes = getModifierTypesForNote(type);

  track.trackEvents = track.trackEvents.filter(
    (e) =>
      e.tick !== tick ||
      (e.type !== baseType && !modifierTypes.has(e.type)),
  );

  // Only remove forceFlam if no other base drum note remains at this tick
  const remainingBasesAtTick = track.trackEvents.some(
    (e) => e.tick === tick && baseDrumEventTypes.has(e.type),
  );
  if (!remainingBasesAtTick) {
    track.trackEvents = track.trackEvents.filter(
      (e) => e.tick !== tick || e.type !== eventTypes.forceFlam,
    );
  }
}

/**
 * Read all drum notes from a track, resolving modifier flags.
 *
 * Returns DrumNote[] sorted by tick.
 */
export function getDrumNotes(track: TrackData): DrumNote[] {
  // Group events by tick for efficient lookup
  const eventsByTick = new Map<number, TrackEvent[]>();
  for (const event of track.trackEvents) {
    let list = eventsByTick.get(event.tick);
    if (!list) {
      list = [];
      eventsByTick.set(event.tick, list);
    }
    list.push(event);
  }

  const notes: DrumNote[] = [];

  eventsByTick.forEach((events, tick) => {
    // Build a set of event types at this tick for fast flag lookup
    const typeSet = new Set<EventType>();
    for (const e of events) {
      typeSet.add(e.type);
    }

    // Find base drum note events
    for (const event of events) {
      const drumType = eventTypeToDrumNote[event.type];
      if (drumType === undefined) continue;
      if (!baseDrumEventTypes.has(event.type)) continue;

      // Resolve flags
      const flags: DrumNoteFlags = {};

      // Cymbal: cymbalMarker present → true, tomMarker present → false, neither → false
      const cymbalType = drumCymbalEventType[drumType];
      const tomType = drumTomEventType[drumType];
      if (cymbalType !== undefined && typeSet.has(cymbalType)) {
        flags.cymbal = true;
      } else if (tomType !== undefined && typeSet.has(tomType)) {
        flags.cymbal = false;
      }
      // If neither marker is present, omit cymbal flag (defaults to undefined/false)

      // Double kick
      if (drumType === 'kick' && typeSet.has(eventTypes.kick2x)) {
        flags.doubleKick = true;
      }

      // Accent
      const accentType = drumAccentEventType[drumType];
      if (accentType !== undefined && typeSet.has(accentType)) {
        flags.accent = true;
      }

      // Ghost
      const ghostType = drumGhostEventType[drumType];
      if (ghostType !== undefined && typeSet.has(ghostType)) {
        flags.ghost = true;
      }

      // Flam
      if (typeSet.has(eventTypes.forceFlam)) {
        flags.flam = true;
      }

      notes.push({
        tick,
        length: event.length,
        type: drumType,
        flags,
      });
    }
  });

  // Sort by tick
  notes.sort((a, b) => a.tick - b.tick);
  return notes;
}

/**
 * Set the modifier flags for an existing drum note at a given tick.
 *
 * Removes all existing modifiers for this note type at the tick,
 * then adds new modifier events based on the provided flags.
 *
 * Throws if no base note of the given type exists at the tick.
 */
export function setDrumNoteFlags(
  track: TrackData,
  tick: number,
  type: DrumNoteType,
  flags: DrumNoteFlags,
): void {
  const baseType = drumNoteEventType[type];

  // Verify the base note exists
  const baseEvent = track.trackEvents.find(
    (e) => e.tick === tick && e.type === baseType,
  );
  if (!baseEvent) {
    throw new Error(
      `No ${type} note found at tick ${tick}`,
    );
  }

  // Remove all existing modifiers for this note type at this tick
  const modifierTypes = getModifierTypesForNote(type);
  track.trackEvents = track.trackEvents.filter(
    (e) => e.tick !== tick || !modifierTypes.has(e.type),
  );

  // Add new modifiers based on flags
  if (flags.cymbal) {
    const cymbalType = drumCymbalEventType[type];
    if (cymbalType !== undefined) {
      pushEvent(track, tick, 0, cymbalType);
    }
  }

  if (flags.doubleKick && type === 'kick') {
    pushEvent(track, tick, 0, eventTypes.kick2x);
  }

  if (flags.accent) {
    const accentType = drumAccentEventType[type];
    if (accentType !== undefined) {
      pushEvent(track, tick, 0, accentType);
    }
  }

  if (flags.ghost) {
    const ghostType = drumGhostEventType[type];
    if (ghostType !== undefined) {
      pushEvent(track, tick, 0, ghostType);
    }
  }

  // Flam is shared across all notes at a tick — handle carefully
  if (flags.flam === true) {
    const flamExists = track.trackEvents.some(
      (e) => e.tick === tick && e.type === eventTypes.forceFlam,
    );
    if (!flamExists) {
      pushEvent(track, tick, 0, eventTypes.forceFlam);
    }
  } else if (flags.flam === false) {
    // Only remove forceFlam if no other base drum note exists at this tick
    const otherBasesAtTick = track.trackEvents.some(
      (e) => e.tick === tick && baseDrumEventTypes.has(e.type) && e.type !== baseType,
    );
    if (!otherBasesAtTick) {
      track.trackEvents = track.trackEvents.filter(
        (e) => e.tick !== tick || e.type !== eventTypes.forceFlam,
      );
    }
  }
  // When flags.flam is undefined, leave existing forceFlam untouched
}
