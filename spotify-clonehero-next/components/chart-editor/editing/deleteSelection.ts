/**
 * Turn the editor's current selection into the commands that delete it.
 *
 * The piano roll's marquee sweeps every band it covers, so a selection can
 * mix notes, lyrics, section flags, time-signature chips and tempo markers.
 * This module is the one place that decides what a Delete does with such a
 * selection, so the hotkey handler stays a thin wrapper and the ordering
 * rule below is unit-testable without React.
 *
 * **Order is load-bearing.** A tempo-marker delete under KEEP-MS glue
 * re-derives every note's tick from its ms, and note (`tick:type`), lyric
 * (`part:tick`), section (`tick`) and time-signature (`tick`) ids are all
 * tick-derived — an id captured before that remap no longer resolves after
 * it. So everything keyed by tick is queued first and the tempo markers
 * last. The markers themselves go out as ONE `DeleteTempoMarkersCommand`
 * rather than N single deletes, so the KEEP-MS remap runs once instead of
 * compounding its rounding N times.
 *
 * Phrase starts and ends are deliberately never deleted here. A marquee
 * over the lyrics row can select them (they are the drag handles for
 * resizing a phrase), but "delete a phrase edge" has no meaning on its own
 * — the phrase-band context menu's "Delete phrase" removes a phrase.
 */

import type {ChartDocument, TrackKey} from '@/lib/chart-edit';
import {parseLyricId} from '@/lib/chart-edit';
import type {ChartEditorState} from '@/lib/chart-editor-core';
import {getSelectedIds} from '@/lib/chart-editor-core';
import {
  DeleteLyricCommand,
  DeleteNotesCommand,
  DeleteSectionCommand,
  DeleteTempoMarkersCommand,
  RemoveTimeSignatureCommand,
  type EditCommand,
  type TempoGlueMode,
} from '../commands';

export interface DeleteSelectionInputs {
  state: ChartEditorState;
  chartDoc: ChartDocument;
  /** Notes resolved to the active track's local ids (`activeNoteIds`). */
  noteIds: ReadonlySet<string>;
  /** Track the selected notes belong to; null when there's no track scope. */
  trackKey: TrackKey | null;
  glue: TempoGlueMode;
}

/**
 * The commands that delete everything currently selected, in the order they
 * must run. Empty when the selection holds nothing deletable, in which case
 * the caller should do nothing at all (not dispatch an empty batch).
 */
export function buildDeleteSelectionCommands(
  inputs: DeleteSelectionInputs,
): EditCommand[] {
  const {state, chartDoc, noteIds, trackKey, glue} = inputs;
  const commands: EditCommand[] = [];

  if (noteIds.size > 0 && trackKey) {
    commands.push(new DeleteNotesCommand(new Set(noteIds), trackKey));
  }

  for (const id of getSelectedIds(state, 'lyric')) {
    const parsed = parseLyricId(id);
    if (parsed) {
      commands.push(new DeleteLyricCommand(parsed.tick, parsed.partName));
    }
  }

  for (const id of getSelectedIds(state, 'section')) {
    const tick = Number.parseInt(id, 10);
    const section = chartDoc.parsedChart.sections.find(s => s.tick === tick);
    if (section) {
      commands.push(new DeleteSectionCommand(section.tick, section.name));
    }
  }

  for (const id of getSelectedIds(state, 'timesig')) {
    const tick = Number.parseInt(id, 10);
    // Tick 0 is the chart's initial meter, which has no "remove" meaning.
    if (Number.isFinite(tick) && tick !== 0) {
      commands.push(new RemoveTimeSignatureCommand(tick));
    }
  }

  const tempoTicks = Array.from(getSelectedIds(state, 'tempo'), id =>
    Number.parseInt(id, 10),
  ).filter(tick => Number.isFinite(tick) && tick !== 0);
  if (tempoTicks.length > 0) {
    commands.push(new DeleteTempoMarkersCommand(tempoTicks, glue));
  }

  return commands;
}
