/**
 * What a committed drag does: the move, and the selection once it has run.
 *
 * Note and lyric ids are positions (`tick:type`, `part:tick`), so a move
 * renames everything it moves, and a selection left on the old names points
 * at nothing — the moved notes lose their halo and Copy has nothing to copy.
 * The new names come from the move itself (`MoveEntitiesCommand.movedIds`),
 * so a note clamped at tick 0 or dropped onto another is followed exactly.
 *
 * The selection travels with the command (`executeCommand(command,
 * selection)`), which makes the rename part of the edit: undo puts the old
 * selection back together with the old positions.
 *
 * Pure: no React, no DOM.
 */

import type {TrackKey} from '@/lib/chart-edit';
import {
  getSelectedIds,
  type ChartEditorState,
  type SelectionPatch,
} from '@/lib/chart-editor-core';
import {
  BatchCommand,
  MoveEntitiesCommand,
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
  {tickDelta, laneDelta}: NoteDragDelta,
): DragCommit | null {
  const doc = state.chartDoc;
  const selection = getSelectedIds(state, 'note');
  const ids = localNoteIdsForTrack(selection, trackKey);
  if (!doc || ids.length === 0 || (tickDelta === 0 && laneDelta === 0)) {
    return null;
  }
  const command = new MoveEntitiesCommand('note', ids, tickDelta, laneDelta, {
    trackKey,
  });
  const moved = command.movedIds(doc);
  const renamed = new Map(
    ids.map((id, i) => [
      trackQualifiedNoteId(trackKey, id),
      trackQualifiedNoteId(trackKey, moved[i]),
    ]),
  );
  return {
    command,
    selection: {
      note: new Set(Array.from(selection, id => renamed.get(id) ?? id)),
    },
  };
}

/**
 * The piano roll's drag of the selection: the selected notes on the dragged
 * row, and every selected lyric riding along at the notes' tick delta. Both
 * moves land in one `BatchCommand`, so one undo reverses the whole drag.
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
  trackKey: TrackKey,
  delta: NoteDragDelta,
): DragCommit | null {
  const notes = noteDragCommit(state, trackKey, delta);
  // The lyric move is worked out on the same doc as the note move. That is
  // where the lyrics land after it too: a note move writes only its track.
  const lyrics = lyricDragCommit(state, delta.tickDelta);
  if (!notes || !lyrics) return notes ?? lyrics;
  return {
    command: new BatchCommand([notes.command, lyrics.command]),
    selection: {...notes.selection, ...lyrics.selection},
  };
}

/** Every selected lyric moved by `tickDelta` (lyrics have no lanes), each
 *  clamped to its own phrase by `moveLyric`. Null when nothing moves. */
function lyricDragCommit(
  state: ChartEditorState,
  tickDelta: number,
): DragCommit | null {
  const doc = state.chartDoc;
  const ids = Array.from(getSelectedIds(state, 'lyric'));
  if (!doc || ids.length === 0 || tickDelta === 0) return null;
  const command = new MoveEntitiesCommand('lyric', ids, tickDelta, 0);
  return {command, selection: {lyric: new Set(command.movedIds(doc))}};
}
