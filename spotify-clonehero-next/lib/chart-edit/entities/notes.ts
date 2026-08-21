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

/** Every lane index in the schema, excluded lanes included. */
export function fullLaneRange(schema: InstrumentSchema): {
  min: number;
  max: number;
} {
  const indices = schema.lanes.map(l => l.index);
  return {min: Math.min(...indices), max: Math.max(...indices)};
}

/**
 * Which lanes a lane-shift gesture may address.
 *
 *  - `'pads'`: the `laneShiftExcludes` lanes (drums' kick, guitar's open) are
 *    off the axis entirely — a note in one never moves, and a note outside
 *    one clamps rather than sliding in. The arrow-key nudge uses this: it is
 *    a *relative* step, so reaching kick by holding Down one beat too long
 *    would be an accident.
 *  - `'all'`: every lane participates. A pointer drag uses this, because it
 *    *points at* a lane — releasing over the kick row says exactly one thing.
 */
export type LaneAxis = 'pads' | 'all';

/** The lane range a gesture on `axis` may address. */
export function laneRangeFor(
  schema: InstrumentSchema,
  axis: LaneAxis,
): {min: number; max: number} {
  return axis === 'all' ? fullLaneRange(schema) : padLaneRange(schema);
}

/**
 * Shift a NoteType by a lane delta among the lanes `axis` admits, clamping at
 * that range's boundaries. On the `'pads'` axis an excluded type never moves.
 */
export function shiftLane(
  schema: InstrumentSchema,
  type: NoteType,
  delta: number,
  axis: LaneAxis = 'pads',
): NoteType {
  if (axis === 'pads' && schema.laneShiftExcludes?.includes(type)) return type;
  const current = typeToLane(schema, type);
  const {min, max} = laneRangeFor(schema, axis);
  if (current === -1 || current < min || current > max) return type;
  return laneToType(schema, Math.max(min, Math.min(max, current + delta)));
}

/**
 * Make `bits` legal for a note of `type`, per `schema`'s bindings.
 *
 * Two rules:
 *
 *  1. Lane legality (§6, invariant 4): clear any flag bit whose binding's
 *     `appliesTo` excludes `type`, and its `complementFlag` bit. A note that
 *     changes type (lane shift, kick↔pad conversion) must not carry over a
 *     flag that is illegal on its new type — a cymbal note dragged onto red
 *     drops the cymbal bit.
 *  2. A complement pair is never both-clear on a type it applies to. If a
 *     caller supplies neither bit, the complement is filled in.
 *
 *     Drums' `cymbal`/`tom` pair is the case that matters. In four-lane
 *     pro drums, `.chart` reads an unmarked yellow, blue or green pad as a
 *     tom, but `.mid` reads it as a cymbal. A flagless pad note therefore
 *     changes instrument when the user exports the other format. `tom` is
 *     the complement, which agrees with the `.chart` reader.
 */
export function legalizeFlagBits(
  schema: InstrumentSchema,
  type: NoteType,
  bits: number,
): number {
  let result = bits;
  for (const b of schema.flagBindings) {
    const applies = !b.appliesTo || b.appliesTo.includes(type);
    if (!applies) {
      result &= ~noteFlags[b.flag];
      if (b.complementFlag) result &= ~noteFlags[b.complementFlag];
      continue;
    }
    if (!b.complementFlag) continue;
    const pair = noteFlags[b.flag] | noteFlags[b.complementFlag];
    if ((result & pair) === 0) result |= noteFlags[b.complementFlag];
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
 * with `complementFlag` toggle between the two states of the pair (flag →
 * complement → flag → …, matching drums' cymbal/tom). Guitar/bass technique
 * flags
 * are mutually exclusive: toggling the active technique clears it to natural;
 * toggling another technique replaces the current one. Other flags toggle as
 * a plain bit.
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

  if (
    (schema.instrument === 'guitar' || schema.instrument === 'bass') &&
    (flag === 'strum' || flag === 'hopo' || flag === 'tap')
  ) {
    const techniqueMask = noteFlags.strum | noteFlags.hopo | noteFlags.tap;
    return (currentBits & bit) !== 0
      ? currentBits & ~techniqueMask
      : (currentBits & ~techniqueMask) | bit;
  }

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
    // Two notes of the same type at the same tick are not a chord, they are
    // the same note twice — a state `.chart` cannot represent. The incoming
    // note wins: every caller that reaches here is placing or moving a note
    // deliberately, so its flags are the intended ones.
    const duplicate = existing.group.findIndex(n => n.type === type);
    if (duplicate >= 0) {
      existing.group[duplicate] = newNote;
    } else {
      existing.group.push(newNote);
    }
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

/** Update a note's sustain length and recompute its push-model timing. */
export function setNoteLength(
  track: ParsedTrackData,
  tick: number,
  type: NoteType,
  length: number,
  timing?: ChartTiming,
): void {
  const note = findNote(track, tick, type);
  if (!note) {
    throw new Error(`No note of type ${type} found at tick ${tick}`);
  }
  note.length = Math.max(0, length);
  if (timing) applyEventTiming(note, timing);
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

  const newType =
    laneDelta !== 0 ? shiftLane(schema, note.type, laneDelta) : note.type;
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

/** One note to move, identified the way the editor identifies it. */
export interface NoteRef {
  tick: number;
  type: NoteType;
}

/**
 * Move several notes as one operation.
 *
 * This is NOT `moveNote` in a loop, and the difference is load-bearing. A note
 * is identified by `(tick, type)`, so moving them one at a time resolves each
 * against a track the earlier moves have already mutated: drag
 * `{blue@100, yellow@100}` up one lane and blue→yellow lands on a yellow@100
 * that hasn't moved yet and is still the id the next step will look up. Every
 * source is therefore resolved against the original track before anything is
 * removed.
 *
 * Destinations that collide collapse, which is what makes a note dropped
 * exactly onto an existing one dedupe rather than double up. Later entries in
 * `refs` win, and a moved note always beats a stationary one — the moved note
 * is the one the user was manipulating.
 *
 * Returns each ref's new id position, in input order; a ref that matched no
 * note maps to `null`.
 */
export function moveNotes(
  parsedChart: ParsedChart,
  track: ParsedTrackData,
  refs: readonly NoteRef[],
  tickDelta: number,
  laneDelta: number,
  schema: InstrumentSchema,
  axis: LaneAxis = 'pads',
): (NoteRef | null)[] {
  // Phase 1: resolve every source against the untouched track, capturing the
  // payload each one carries with it.
  const resolved = refs.map(ref => {
    const note = findNote(track, ref.tick, ref.type);
    if (!note) return null;
    const newType =
      laneDelta !== 0
        ? shiftLane(schema, note.type, laneDelta, axis)
        : note.type;
    return {
      from: {tick: note.tick, type: note.type},
      to: {tick: Math.max(0, note.tick + tickDelta), type: newType},
      length: note.length,
      flags: note.flags,
    };
  });

  // Phase 2: vacate every source before filling any destination, so a
  // destination can reuse a slot another source is leaving.
  for (const move of resolved) {
    if (move) removeNote(track, move.from.tick, move.from.type, schema);
  }

  // Phase 3: place the destinations. `addNote` collapses a same-(tick, type)
  // collision onto the incoming note, so both a moved-onto-stationary and a
  // moved-onto-moved landing dedupe here.
  const timing = makeChartTiming(parsedChart);
  for (const move of resolved) {
    if (!move) continue;
    addNote(
      track,
      {
        tick: move.to.tick,
        type: move.to.type,
        length: move.length,
        flags: move.flags,
      },
      schema,
      timing,
    );
  }

  return resolved.map(move => (move ? move.to : null));
}
