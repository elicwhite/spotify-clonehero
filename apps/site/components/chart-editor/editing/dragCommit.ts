/**
 * What a committed drag does: its moves, and the selection once they have
 * run.
 *
 * Note, lyric and phrase-edge ids are positions (`tick:type`, `part:tick`),
 * so a move renames everything it moves, and a selection left on the old
 * names points at nothing — the moved notes lose their halo and Copy has
 * nothing to copy. The new names come from the moves themselves
 * (`MoveEntitiesCommand.movedIds`, `MovePhrasesCommand.renamedIds`), so a
 * note clamped at tick 0 or dropped onto another is followed exactly.
 *
 * The selection travels with the command (`executeCommand(command,
 * selection)`), which makes the rename part of the edit: undo puts the old
 * selection back together with the old positions.
 *
 * Pure: no React, no DOM.
 */

import type {ChartDocument, SelectableKind, TrackKey} from '@/lib/chart-edit';
import {
  getSelectedIds,
  type ChartEditorState,
  type SelectionPatch,
} from '@/lib/chart-editor-core';
import {
  BatchCommand,
  MoveEntitiesCommand,
  MovePhrasesCommand,
  type EditCommand,
} from '@/lib/chart-editor-core/commands';
import {
  localNoteIdsForTrack,
  trackQualifiedNoteId,
} from '@/lib/chart-editor-core/scope';
import type {NoteDragDelta} from './gestures';

export interface DragCommit {
  command: EditCommand;
  selection: SelectionPatch;
}

/** One move of a drag, and the ids it renames: old id to new, per kind. */
interface Move {
  command: EditCommand;
  renamed: Partial<Record<SelectableKind, ReadonlyMap<string, string>>>;
}

const NO_PHRASES: ReadonlySet<number> = new Set();

/**
 * A note drag: every selected note on `trackKey` moves by the drag's deltas.
 * Selected notes on other tracks stay as they are, still selected.
 *
 * Null when the drag moves nothing: no chart, no selected note on
 * `trackKey`, or a drag that ends where it started.
 */
export function noteDragCommit(
  state: ChartEditorState,
  trackKey: TrackKey,
  delta: NoteDragDelta,
): DragCommit | null {
  return commitMoves(state, [noteMove(state, trackKey, delta)]);
}

/**
 * The piano roll's drag of the selection, by a note or by a lyric chip.
 * Everything selected rides the drag: the selected notes on `trackKey` move
 * by its deltas, and every selected lyric by its tick delta, clamped to its
 * own phrase. With no `trackKey` (the editor is on no notes track), only the
 * lyrics move. All of it lands in one `BatchCommand`, so one undo reverses
 * the whole drag.
 *
 * `movingPhraseTicks` are the phrases a chip drag carries whole: those with
 * both edges selected, when the grabbed chip is in one of them. Their
 * lyrics keep their places inside them.
 *
 * Co-selected tempo markers and signature chips deliberately stay put. A
 * marker move is not a tick translation: `applyMarkerMoveBpms` moves it in
 * MS and rewrites the BPM of the segments on both sides, so "move five
 * markers by this delta" needs its own lib operation (and its own
 * `MIN_SEGMENT_MS` clamping) before it can mean anything. Sections are
 * chart-wide and likewise ride only their own ruler drag.
 *
 * Null when nothing selected moves.
 */
export function selectionDragCommit(
  state: ChartEditorState,
  trackKey: TrackKey | undefined,
  delta: NoteDragDelta,
  movingPhraseTicks: ReadonlySet<number> = NO_PHRASES,
): DragCommit | null {
  return commitMoves(state, [
    trackKey ? noteMove(state, trackKey, delta) : null,
    ...vocalsMoves(state, delta.tickDelta, movingPhraseTicks),
  ]);
}

function noteMove(
  state: ChartEditorState,
  trackKey: TrackKey,
  {tickDelta, laneDelta}: NoteDragDelta,
): Move | null {
  const doc = state.chartDoc;
  const ids = localNoteIdsForTrack(getSelectedIds(state, 'note'), trackKey);
  if (!doc || ids.length === 0 || (tickDelta === 0 && laneDelta === 0)) {
    return null;
  }
  const command = new MoveEntitiesCommand('note', ids, tickDelta, laneDelta, {
    trackKey,
  });
  const qualified = (localIds: string[]) =>
    localIds.map(id => trackQualifiedNoteId(trackKey, id));
  return {
    command,
    renamed: {note: renames(qualified(ids), qualified(command.movedIds(doc)))},
  };
}

/**
 * The moves of the selected lyrics (lyrics have no lanes). A lyric moves on
 * its own, clamped to its phrase by `moveLyric`, unless its phrase is one of
 * `startTicks`: those travel whole and carry their lyrics and edges with
 * them.
 */
function vocalsMoves(
  state: ChartEditorState,
  tickDelta: number,
  startTicks: ReadonlySet<number>,
): (Move | null)[] {
  const doc = state.chartDoc;
  if (!doc || tickDelta === 0) return [];
  const travel =
    startTicks.size > 0 ? phraseTravel(doc, startTicks, tickDelta) : null;
  const loose = Array.from(getSelectedIds(state, 'lyric')).filter(
    id => !travel?.renamed.lyric?.has(id),
  );
  // The loose lyrics move first. `moveLyric` finds a lyric by its tick, and
  // a travelling phrase can carry a lyric onto a loose lyric's tick; before
  // the travel, each loose lyric is found where `movedIds` found it.
  return [lyricMove(doc, loose, tickDelta), travel];
}

function lyricMove(
  doc: ChartDocument,
  ids: readonly string[],
  tickDelta: number,
): Move | null {
  if (ids.length === 0) return null;
  const command = new MoveEntitiesCommand('lyric', ids, tickDelta, 0);
  return {command, renamed: {lyric: renames(ids, command.movedIds(doc))}};
}

/** The phrases at `startTicks` travelling whole (`MovePhrasesCommand`). */
function phraseTravel(
  doc: ChartDocument,
  startTicks: ReadonlySet<number>,
  tickDelta: number,
): Move {
  const command = new MovePhrasesCommand(Array.from(startTicks), tickDelta);
  return {command, renamed: command.renamedIds(doc)};
}

/** Old id to new: `from[i]` becomes `to[i]`. */
function renames(
  from: readonly string[],
  to: readonly string[],
): Map<string, string> {
  return new Map(from.map((id, i) => [id, to[i]]));
}

/**
 * The moves as one step, and the selection with every renamed id under its
 * new name. Several moves make one `BatchCommand`, so one undo reverses them
 * all.
 *
 * Each move was worked out on the doc as it is now, and no move reads what
 * an earlier one in the batch writes: a note move writes only its track, and
 * a lyric move only lyrics of phrases that do not travel. No two moves
 * rename the same id, so the renames of a kind merge into one map.
 */
function commitMoves(
  state: ChartEditorState,
  moves: readonly (Move | null)[],
): DragCommit | null {
  const present = moves.filter((move): move is Move => move !== null);
  if (present.length === 0) return null;
  const renamed = new Map<SelectableKind, Map<string, string>>();
  for (const move of present) {
    for (const [kind, ids] of Object.entries(move.renamed) as [
      SelectableKind,
      ReadonlyMap<string, string>,
    ][]) {
      renamed.set(kind, new Map([...(renamed.get(kind) ?? []), ...ids]));
    }
  }
  const selection: SelectionPatch = {};
  for (const [kind, ids] of renamed) {
    selection[kind] = followRenames(state, kind, ids);
  }
  return {
    command:
      present.length === 1
        ? present[0].command
        : new BatchCommand(present.map(move => move.command)),
    selection,
  };
}

/** The selected ids of `kind`, each renamed where `renamed` names it. */
function followRenames(
  state: ChartEditorState,
  kind: SelectableKind,
  renamed: ReadonlyMap<string, string>,
): Set<string> {
  return new Set(
    Array.from(getSelectedIds(state, kind), id => renamed.get(id) ?? id),
  );
}
