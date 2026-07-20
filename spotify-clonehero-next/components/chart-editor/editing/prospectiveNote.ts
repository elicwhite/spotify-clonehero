/**
 * Shared "prospective note" computation (plan 0062 "Two views, one store").
 *
 * The add-note tool, on both the highway (`useHighwayMouseInteraction`) and the
 * piano-roll timeline, turns a hovered lane + a grid-snapped tick into the note
 * that a click would place. That mapping — lane → note type, type → default
 * flags — must be identical in both views, or the add-mode ghost preview would
 * predict a different note than the one the click actually adds. This module is
 * that one computation; each view resolves the lane + snapped tick from its own
 * coordinate space (highway raycasts, piano roll ms x-axis) and calls this.
 *
 * Lane legality (kick/red can never be cymbals, §6) is inherited for free:
 * `defaultFlagsForType` only sets `cymbal` on the schema's cymbal-default lanes
 * (a subset of the cymbal-legal lanes), so `cymbal` here is never true on an
 * illegal lane. The same `defaultFlagsForType` feeds the real `AddNoteCommand`,
 * so the ghost and the placed note can never disagree.
 *
 * Pure: no React, no DOM.
 */

import type {NoteType} from '@eliwhite/scan-chart';
import {noteFlags} from '@eliwhite/scan-chart';
import {
  drums4LaneSchema,
  laneToType as schemaLaneToType,
  defaultFlagBits,
  type InstrumentSchema,
} from '@/lib/chart-edit';

/** The note the add-note tool would place at a hovered lane + snapped tick. */
export interface ProspectiveNote {
  /** Grid-snapped tick the note would land on. */
  tick: number;
  /** Editor lane index (0=red, 1=yellow, 2=blue, 3=green, 4=kick for the
   *  default drum schema). */
  lane: number;
  /** scan-chart NoteType the lane maps to, per `schema`. */
  type: NoteType;
  /** Default flag bitmask for a fresh note of this type (legality already
   *  enforced by `schema`'s flag bindings). */
  flags: number;
  /** True when the note would be a cymbal (triangle glyph); never on kick/red
   *  in the default drum schema. */
  cymbal: boolean;
}

/**
 * Resolve the note the add-note tool would place on `lane` at `snappedTick`,
 * for `schema` (defaults to `drums4LaneSchema` — the only schema wired into
 * the editor UI today). Both the highway placement path and the piano-roll
 * ghost/placement path call this so they predict — and add — the identical
 * note.
 */
export function prospectiveNoteAt(
  lane: number,
  snappedTick: number,
  schema: InstrumentSchema = drums4LaneSchema,
): ProspectiveNote {
  const type = schemaLaneToType(schema, lane);
  const flags = defaultFlagBits(schema, type);
  return {
    tick: snappedTick,
    lane,
    type,
    flags,
    cymbal: (flags & noteFlags.cymbal) !== 0,
  };
}
