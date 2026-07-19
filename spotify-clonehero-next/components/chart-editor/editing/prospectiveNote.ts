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

import type {DrumNoteType, DrumNoteFlags} from '@/lib/chart-edit';
import {laneToType, defaultFlagsForType} from '../commands';

/** The note the add-note tool would place at a hovered lane + snapped tick. */
export interface ProspectiveNote {
  /** Grid-snapped tick the note would land on. */
  tick: number;
  /** Editor lane index (0=kick, 1=red, 2=yellow, 3=blue, 4=green). */
  lane: number;
  /** scan-chart drum type the lane maps to. */
  type: DrumNoteType;
  /** Default flags for a fresh note of this type (legality already enforced). */
  flags: DrumNoteFlags;
  /** True when the note would be a cymbal (triangle glyph); never on kick/red. */
  cymbal: boolean;
}

/**
 * Resolve the note the add-note tool would place on `lane` at `snappedTick`.
 * Both the highway placement path and the piano-roll ghost/placement path call
 * this so they predict — and add — the identical note.
 */
export function prospectiveNoteAt(
  lane: number,
  snappedTick: number,
): ProspectiveNote {
  const type = laneToType(lane);
  const flags = defaultFlagsForType(type);
  return {
    tick: snappedTick,
    lane,
    type,
    flags,
    cymbal: flags.cymbal === true,
  };
}
