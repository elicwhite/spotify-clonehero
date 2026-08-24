/**
 * Every per-note item the piano-roll context menu offers for a selection,
 * as data (plan 0126 §4).
 *
 * `buildNoteMenu` used to grow one hand-written block per property — a
 * schema guard, a loop, a `push`, and its own copy of the
 * "if we have a track key, execute a command" closure. Five properties meant
 * five near-identical blocks in an already very large component. They are
 * all the same shape, so they are one list here instead, and the component
 * only resolves the selection and maps.
 *
 * Two rules run through the whole file:
 *
 *  - **Legality is per lane.** An action only ever targets the notes whose
 *    lane can carry the property, and disappears when that leaves nothing —
 *    `flagAppliesTo` is the same predicate the mutators enforce, so the menu
 *    never offers an edit that would be silently refused.
 *  - **Add/Remove is an "any" test, not an "all" test.** Add is offered when
 *    any target lacks the property and Remove when any target has it, so a
 *    mixed selection offers both and either direction is reachable without
 *    splitting the selection first. A uniform selection offers exactly one.
 *
 * Pure: no React, no canvas, no editor state. Commands are constructed but
 * not run, so the whole menu can be asserted without driving a right-click
 * at exact note pixels — the same way `hitTest` and `contextMenuPlacement`
 * are tested.
 */

import {
  flagAppliesTo,
  usesFretEditing,
  laneToType,
  type InstrumentSchema,
  type NoteFlagName,
  type TrackKey,
} from '@/lib/chart-edit';
import {
  DeleteNotesCommand,
  SetFlagCommand,
  SetNoteLengthCommand,
  SetNoteTechniqueCommand,
  ToggleFlagCommand,
  type EditCommand,
  type FretTechnique,
} from '../commands';
import {techniqueForFlags, type PianoRollNote} from './notes';

/**
 * Ticks of tail "Add sustain" gives a note, as a multiple of the resolution
 * (ticks per quarter note) — i.e. two beats, a half note in 4/4.
 *
 * Deliberately NOT the snap division: the menu item promises one length and
 * gives that length whatever the snap control happens to read, where the
 * drag-resize is the tool for a length you want to pick by eye.
 */
export const SUSTAIN_BEATS = 2;

/** Tail length in ticks that "Add sustain" writes, for a chart at
 *  `resolution` ticks per quarter note. */
export function sustainTicks(resolution: number): number {
  return resolution * SUSTAIN_BEATS;
}

/** One offered menu item, ready for the component to render. */
export interface NoteMenuAction {
  label: string;
  /** Radio-style tick, for the mutually-exclusive technique items. */
  checked?: boolean;
  /** Destructive styling, for Delete. */
  danger?: boolean;
  /** Builds the command this item runs. Kept as a factory so the action can
   *  be asserted without a `TrackKey` and without touching the document. */
  makeCommand: (trackKey: TrackKey) => EditCommand;
}

/** What a selection needs to describe before its menu can be built. */
export interface NoteMenuContext {
  schema: InstrumentSchema;
  /** Every selected note on this track, in any lane. */
  targets: PianoRollNote[];
  resolution: number;
}

/** The selected notes whose lane may legally carry `flag`. */
function legalFor(ctx: NoteMenuContext, flag: NoteFlagName): PianoRollNote[] {
  return ctx.targets.filter(n =>
    flagAppliesTo(ctx.schema, flag, laneToType(ctx.schema, n.lane)),
  );
}

/**
 * Every action for `targets`, in menu order: sustain, technique, cymbal,
 * dynamics, delete.
 *
 * Returns an empty list for an empty selection. Each contributor is free to
 * return nothing, which is how a schema opts out — there is no per-instrument
 * branching in the caller.
 */
export function noteMenuActions(ctx: NoteMenuContext): NoteMenuAction[] {
  if (ctx.targets.length === 0) return [];
  return [
    ...sustainActions(ctx),
    ...techniqueActions(ctx),
    ...cymbalActions(ctx),
    ...dynamicsActions(ctx),
    deleteAction(ctx),
  ];
}

/**
 * "Add sustain" / "Remove sustain" for the five-fret schemas.
 *
 * Sustain is a length, not an articulation, so it sits outside the
 * mutually-exclusive technique list and combines with any of them. Add
 * writes an absolute length rather than a delta, so a selection of ragged
 * tails ends up uniform instead of each note growing by the same amount from
 * wherever it started — which is also why Add stays on offer for an
 * already-sustained selection at some other length, since that is the only
 * way to normalize them.
 */
function sustainActions(ctx: NoteMenuContext): NoteMenuAction[] {
  // Same predicate `SetNoteLengthCommand` and `ResizeNotesCommand` gate on,
  // so the menu never offers a tail the command would refuse or the panel
  // could not draw.
  if (!usesFretEditing(ctx.schema)) return [];
  const ids = ctx.targets.map(n => n.id);
  const lengths = ctx.targets.map(n => n.length ?? 0);
  const target = sustainTicks(ctx.resolution);
  const setLength = (length: number) => (trackKey: TrackKey) =>
    new SetNoteLengthCommand(ids, length, trackKey, ctx.schema);

  const actions: NoteMenuAction[] = [];
  // A zero length is covered by the same test, so this is the whole
  // condition — no separate "any note lacks a tail" clause.
  if (lengths.some(l => l !== target)) {
    actions.push({label: 'Add sustain', makeCommand: setLength(target)});
  }
  if (lengths.some(l => l > 0)) {
    actions.push({label: 'Remove sustain', makeCommand: setLength(0)});
  }
  return actions;
}

/** Radio-style natural / strum / HOPO / tap, five-fret only. */
function techniqueActions(ctx: NoteMenuContext): NoteMenuAction[] {
  if (!usesFretEditing(ctx.schema)) return [];
  const ids = ctx.targets.map(n => n.id);
  const techniques: FretTechnique[] = ['natural', 'strum', 'hopo', 'tap'];
  return techniques.map(technique => ({
    label: techniqueLabel(technique),
    checked: ctx.targets.every(
      n => techniqueForFlags(n.flags ?? 0) === technique,
    ),
    makeCommand: (trackKey: TrackKey) =>
      new SetNoteTechniqueCommand(ids, technique, trackKey, ctx.schema),
  }));
}

function techniqueLabel(technique: FretTechnique): string {
  if (technique === 'natural') return 'Natural (auto)';
  if (technique === 'hopo') return 'HOPO';
  return technique[0].toUpperCase() + technique.slice(1);
}

/** "Switch to cymbal" / "Switch to tom", on the lanes that can be either. */
function cymbalActions(ctx: NoteMenuContext): NoteMenuAction[] {
  const legal = legalFor(ctx, 'cymbal');
  if (legal.length === 0) return [];
  const ids = legal.map(n => n.id);
  const allCymbal = legal.every(n => n.cymbal);
  return [
    {
      label: allCymbal ? 'Switch to tom' : 'Switch to cymbal',
      makeCommand: (trackKey: TrackKey) =>
        new ToggleFlagCommand(ids, 'cymbal', trackKey, ctx.schema),
    },
  ];
}

/**
 * Add/Remove accent and ghost, on the lanes that can carry them — every drum
 * pad but the kick.
 *
 * Each flag asks `legalFor` about itself. The two happen to share one
 * `appliesTo` today, but nothing here depends on that: if one ever narrows,
 * its items narrow with it instead of silently following the other's rule.
 *
 * Accent and ghost share an exclusive group, so adding one clears the other
 * in the mutator; nothing here has to know that.
 */
function dynamicsActions(ctx: NoteMenuContext): NoteMenuAction[] {
  const actions: NoteMenuAction[] = [];
  for (const flag of ['accent', 'ghost'] as const) {
    const legal = legalFor(ctx, flag);
    if (legal.length === 0) continue;
    const ids = legal.map(n => n.id);
    const has = legal.filter(n => n.dynamic === flag).length;
    const setFlag = (on: boolean) => (trackKey: TrackKey) =>
      new SetFlagCommand(ids, flag, on, trackKey, ctx.schema);
    if (has < legal.length) {
      actions.push({label: `Add ${flag}`, makeCommand: setFlag(true)});
    }
    if (has > 0) {
      actions.push({label: `Remove ${flag}`, makeCommand: setFlag(false)});
    }
  }
  return actions;
}

function deleteAction(ctx: NoteMenuContext): NoteMenuAction {
  const ids = ctx.targets.map(n => n.id);
  return {
    label: ids.length > 1 ? `Delete ${ids.length} notes` : 'Delete note',
    danger: true,
    makeCommand: (trackKey: TrackKey) =>
      new DeleteNotesCommand(new Set(ids), trackKey, ctx.schema),
  };
}
