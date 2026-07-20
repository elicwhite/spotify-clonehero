/**
 * Schema-driven note adapter (plan 0037 Task 4).
 *
 * The single source of the lane/flag math the note-family commands
 * (`components/chart-editor/commands.ts`'s `AddNoteCommand`,
 * `DeleteNotesCommand`, `ToggleFlagCommand`, `ToggleKickCommand`) and the
 * `'note'` `EntityKindHandler` (`entities/index.ts`) both drive. Everything
 * here is parameterized by an `InstrumentSchema` and operates directly on
 * scan-chart `NoteEvent`s (raw `NoteType` + flag bitmask), so the same
 * functions work for `guitarSchema` or any other five-fret/drum schema.
 *
 * `lib/chart-edit/helpers/drum-notes.ts` is a thin `drums4LaneSchema`-bound
 * convenience layer over these functions for drum consumers.
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import type {NoteType} from '@eliwhite/scan-chart';
import type {NoteEvent, ParsedChart, ParsedTrackData} from '../types';
import {applyEventTiming, makeChartTiming, type ChartTiming} from '../retime';
import type {InstrumentSchema, NoteFlagName} from '../instruments/types';

/** Reverse map of scan-chart's `noteTypes` (value → key name), built once.
 *  Note ids encode this name (e.g. `"480:redDrum"`) — scan-chart's own key
 *  names double as friendly names. */
const NOTE_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(noteTypes).map(([name, value]) => [value, name]),
);
const NOTE_TYPE_VALUES: Record<string, NoteType> = Object.fromEntries(
  Object.entries(noteTypes),
) as Record<string, NoteType>;

/** Composite key for a note: `${tick}:${noteTypeName}`. */
export function schemaNoteId(tick: number, type: NoteType): string {
  return `${tick}:${NOTE_TYPE_NAMES[type] ?? type}`;
}

/** Parse a `schemaNoteId` back into `{tick, type}`, validating the type is
 *  one of `schema`'s lanes. Returns null for a malformed or foreign id. */
export function parseSchemaNoteId(
  id: string,
  schema: InstrumentSchema,
): {tick: number; type: NoteType} | null {
  const colon = id.indexOf(':');
  if (colon === -1) return null;
  const tick = Number.parseInt(id.slice(0, colon), 10);
  if (!Number.isFinite(tick)) return null;
  const name = id.slice(colon + 1);
  const type = NOTE_TYPE_VALUES[name];
  if (type === undefined) return null;
  if (!schema.lanes.some(l => l.noteType === type)) return null;
  return {tick, type};
}

/** Lane index a NoteType occupies in `schema`, or -1 if it isn't a lane. */
export function typeToLane(schema: InstrumentSchema, type: NoteType): number {
  return schema.lanes.find(l => l.noteType === type)?.index ?? -1;
}

/** NoteType occupying `lane` in `schema`, clamped to the schema's range. */
export function laneToType(schema: InstrumentSchema, lane: number): NoteType {
  const indices = schema.lanes.map(l => l.index);
  const clamped = Math.max(
    Math.min(...indices),
    Math.min(Math.max(...indices), lane),
  );
  return (schema.lanes.find(l => l.index === clamped) ?? schema.lanes[0])
    .noteType;
}

/** Min/max lane index among `schema`'s lanes that participate in the
 *  lane-shift axis (i.e. not in `laneShiftExcludes`). */
export function padLaneRange(schema: InstrumentSchema): {
  min: number;
  max: number;
} {
  const excludes = new Set(schema.laneShiftExcludes ?? []);
  const indices = schema.lanes
    .filter(l => !excludes.has(l.noteType))
    .map(l => l.index);
  return {min: Math.min(...indices), max: Math.max(...indices)};
}

/**
 * Shift a NoteType by a lane delta among `schema`'s non-excluded lanes.
 * Excluded lanes (e.g. drums' kick) never change type; the remaining lanes
 * clamp at the boundaries of the non-excluded range instead of sliding into
 * an excluded lane.
 */
export function shiftLane(
  schema: InstrumentSchema,
  type: NoteType,
  delta: number,
): NoteType {
  if (schema.laneShiftExcludes?.includes(type)) return type;
  const current = typeToLane(schema, type);
  const {min, max} = padLaneRange(schema);
  if (current === -1 || current < min || current > max) return type;
  return laneToType(schema, Math.max(min, Math.min(max, current + delta)));
}

/**
 * Clear any flag bit whose binding's `appliesTo` excludes `type` (and its
 * `complementFlag` bit, if any) — the lane-legality gate (§6, invariant 4):
 * a note that changes type (lane shift, kick↔pad conversion) can't carry
 * over a flag that's illegal on its new type (e.g. a cymbal note dragged
 * onto red must drop the cymbal bit).
 */
export function legalizeFlagBits(
  schema: InstrumentSchema,
  type: NoteType,
  bits: number,
): number {
  let result = bits;
  for (const b of schema.flagBindings) {
    if (!b.appliesTo || b.appliesTo.includes(type)) continue;
    result &= ~noteFlags[b.flag];
    if (b.complementFlag) result &= ~noteFlags[b.complementFlag];
  }
  return result;
}

/** Flag bindings of `schema` marked to sync across every note sharing a
 *  tick (e.g. drums' `flam`), as their `noteFlags` bits. */
function groupSharedBits(schema: InstrumentSchema): number[] {
  return schema.flagBindings
    .filter(b => b.groupShared)
    .map(b => noteFlags[b.flag]);
}

/** Default flag bitmask for a freshly-placed note of `type`, from every
 *  `defaultOn` binding in `schema` that legally applies to `type`. */
export function defaultFlagBits(
  schema: InstrumentSchema,
  type: NoteType,
): number {
  let bits = 0;
  for (const b of schema.flagBindings) {
    if (!b.defaultOn) continue;
    if (b.appliesTo && !b.appliesTo.includes(type)) continue;
    bits |= noteFlags[b.flag];
  }
  return bits;
}

/**
 * Toggle `flag` on `currentBits` for a note of `type`, per `schema`'s
 * binding. A no-op (bits stay clear) when `flag`'s `appliesTo` excludes
 * `type` (lane legality, e.g. kick/red can never be a cymbal). Bindings
 * with `complementFlag` toggle tri-state (unset → flag → complement →
 * flag → …, matching drums' cymbal/tom pair); others toggle as a plain bit.
 */
export function toggleFlagBits(
  schema: InstrumentSchema,
  type: NoteType,
  currentBits: number,
  flag: NoteFlagName,
): number {
  const binding = schema.flagBindings.find(b => b.flag === flag);
  if (!binding) return currentBits;
  const legal = !binding.appliesTo || binding.appliesTo.includes(type);
  const bit = noteFlags[flag];

  if (binding.complementFlag) {
    const complementBit = noteFlags[binding.complementFlag];
    const cleared = currentBits & ~bit & ~complementBit;
    if (!legal) return cleared;
    const wasSet = (currentBits & bit) !== 0;
    return wasSet ? cleared | complementBit : cleared | bit;
  }

  if (!legal) return currentBits & ~bit;
  return currentBits ^ bit;
}

// ---------------------------------------------------------------------------
// Track mutation — direct NoteEvent read/write, schema-scoped
// ---------------------------------------------------------------------------

function groupAt(
  track: ParsedTrackData,
  tick: number,
): {group: NoteEvent[]; index: number} | null {
  for (let i = 0; i < track.noteEventGroups.length; i++) {
    const group = track.noteEventGroups[i];
    if (group.length > 0 && group[0].tick === tick) return {group, index: i};
  }
  return null;
}

/** All notes in `track` whose type is one of `schema`'s lanes, sorted by
 *  tick. */
export function listNotes(
  track: ParsedTrackData,
  schema: InstrumentSchema,
): NoteEvent[] {
  const types = new Set(schema.lanes.map(l => l.noteType));
  const notes: NoteEvent[] = [];
  for (const group of track.noteEventGroups) {
    for (const note of group) {
      if (types.has(note.type)) notes.push(note);
    }
  }
  return notes.sort((a, b) => a.tick - b.tick);
}

/** Find a single note by tick + type, or null. */
export function findNote(
  track: ParsedTrackData,
  tick: number,
  type: NoteType,
): NoteEvent | null {
  return groupAt(track, tick)?.group.find(n => n.type === type) ?? null;
}

/**
 * Insert a note into `track`, in place. No-op — silently skipped by the
 * caller via a pre-check — is NOT performed here; callers that must not
 * clobber an existing note at the same tick+type check first (mirrors the
 * prior `AddNoteCommand` behavior).
 *
 * `timing` (build once per mutation via `makeChartTiming(parsedChart)`)
 * computes the note's `msTime`/`msLength` at insertion time (push model,
 * plan 0061 §2); omit for callers that will re-derive timing on reparse.
 */
export function addNote(
  track: ParsedTrackData,
  note: {tick: number; type: NoteType; length?: number; flags?: number},
  schema: InstrumentSchema,
  timing?: ChartTiming,
): void {
  const {tick, type, length = 0, flags = 0} = note;
  const legalFlags = legalizeFlagBits(schema, type, flags);
  const newNote: NoteEvent = {
    tick,
    msTime: 0,
    length,
    msLength: 0,
    type,
    flags: legalFlags,
  };
  if (timing) applyEventTiming(newNote, timing);

  const existing = groupAt(track, tick);
  if (existing) {
    existing.group.push(newNote);
    for (const bit of groupSharedBits(schema)) {
      if (newNote.flags & bit) {
        for (const n of existing.group) n.flags |= bit;
      }
    }
  } else {
    track.noteEventGroups.push([newNote]);
    track.noteEventGroups.sort((a, b) => {
      const tickA = a.length > 0 ? a[0].tick : 0;
      const tickB = b.length > 0 ? b[0].tick : 0;
      return tickA - tickB;
    });
  }
}

/** Remove a note (and re-sync group-shared flags on the remainder). */
export function removeNote(
  track: ParsedTrackData,
  tick: number,
  type: NoteType,
  schema: InstrumentSchema,
): void {
  const found = groupAt(track, tick);
  if (!found) return;
  const {group, index} = found;
  const filtered = group.filter(n => n.type !== type);

  if (filtered.length === 0) {
    track.noteEventGroups.splice(index, 1);
    return;
  }
  for (const bit of groupSharedBits(schema)) {
    if (!filtered.some(n => n.flags & bit)) {
      for (const n of filtered) n.flags &= ~bit;
    }
  }
  track.noteEventGroups[index] = filtered;
}

/** Overwrite a note's flag bitmask (and re-sync group-shared flags). Throws
 *  if no note of `type` exists at `tick` (mirrors the prior
 *  `setDrumNoteFlags` contract). */
export function setNoteFlags(
  track: ParsedTrackData,
  tick: number,
  type: NoteType,
  bits: number,
  schema: InstrumentSchema,
): void {
  const found = groupAt(track, tick);
  const note = found?.group.find(n => n.type === type);
  if (!found || !note) {
    throw new Error(`No note of type ${type} found at tick ${tick}`);
  }
  note.flags = bits;
  for (const binding of schema.flagBindings) {
    if (!binding.groupShared) continue;
    const bit = noteFlags[binding.flag];
    if (bits & bit) {
      for (const n of found.group) n.flags |= bit;
    } else {
      const othersHaveIt = found.group.some(n => n !== note && n.flags & bit);
      if (!othersHaveIt) {
        for (const n of found.group) n.flags &= ~bit;
      }
    }
  }
}

/**
 * Move a note by `tickDelta` (always) and `laneDelta` (only when nonzero —
 * `shiftLane` no-ops on excluded lanes). Removes + re-adds under the new
 * tick/type so timing recomputes; returns the note's new id, or null if no
 * note existed at `tick`/`type`.
 */
export function moveNote(
  parsedChart: ParsedChart,
  track: ParsedTrackData,
  tick: number,
  type: NoteType,
  tickDelta: number,
  laneDelta: number,
  schema: InstrumentSchema,
): {tick: number; type: NoteType} | null {
  const note = findNote(track, tick, type);
  if (!note) return null;

  const newType = laneDelta !== 0 ? shiftLane(schema, note.type, laneDelta) : note.type;
  const newTick = Math.max(0, note.tick + tickDelta);
  if (newTick === note.tick && newType === note.type) return {tick, type};

  removeNote(track, note.tick, note.type, schema);
  addNote(
    track,
    {tick: newTick, type: newType, length: note.length, flags: note.flags},
    schema,
    makeChartTiming(parsedChart),
  );
  return {tick: newTick, type: newType};
}
