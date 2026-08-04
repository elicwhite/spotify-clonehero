'use client';

/**
 * The Chart Matrix's right-click delete menu (plan 0077 item 6, OWNER
 * OVERRIDE 2026-08-04: per-difficulty deletion).
 *
 * The popover, its positioning and its dismissal lifecycle are the editor's
 * shared `ContextMenuPopover`, the same one the piano roll opens. What lives
 * here is only what is specific to deleting tracks: which deletions a given
 * surface offers, what each is called, and the two-step confirm.
 *
 * Confirming reuses the SAME popover rather than opening an `AlertDialog` (the
 * app's other confirm pattern, e.g. `DifficultyGenerationCard`'s "Delete
 * Hard/Medium/Easy"): a right-click menu is already transient UI anchored at
 * the pointer, so keeping the cancel-and-reopen flow in one surface beats
 * layering a second overlay on top of it.
 *
 * Deleting the last visible track is not this component's problem. The
 * reducer restores the at-least-one-visible invariant whenever a doc change
 * empties the visible set (`reconcileVisibleTracks`), so a delete here is one
 * dispatch with no follow-up, and undo is symmetric for free.
 */

import {useCallback, useState} from 'react';
import {toast} from 'sonner';

import type {
  SupportedTrackInstrument,
  SupportedTrackKey,
} from '@/lib/chart-editor-core';

import ContextMenuPopover, {
  useDismissOnEscape,
  useDismissOnOutsidePointerDown,
} from '../ContextMenuPopover';
import {
  DeleteInstrumentCommand,
  DeleteLowerDifficultiesCommand,
  DeleteTrackCommand,
  type EditCommand,
} from '../commands';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {INSTRUMENT_LABEL, trackLabel} from '../trackLabels';

/** What the menu was opened on — the only input to which items it offers. */
export interface MatrixMenuTarget {
  /** Viewport coordinates of the opening right-click. */
  x: number;
  y: number;
  instrument: SupportedTrackInstrument;
  /** The cell's track when the menu was opened on a cell; null on the row
   *  label, which is not anchored on any one difficulty. */
  trackKey: SupportedTrackKey | null;
  /** Whether this instrument has any of Hard/Medium/Easy charted. */
  hasLowerDifficulties: boolean;
}

/**
 * One offered deletion, complete: its menu label, its confirm copy, its
 * success toast, and the command that performs it. Everything a deletion
 * needs is decided once, here, so adding a fourth is one more entry rather
 * than a new arm in several parallel switches.
 */
interface DeleteAction {
  label: string;
  title: string;
  body: string;
  toast: string;
  command: EditCommand;
}

/**
 * The deletions `target` offers, in menu order. A cell offers all three; the
 * row label omits "Delete difficulty" — it isn't anchored on one. Both omit
 * "Delete all lower difficulties" when the instrument has none charted.
 */
function deleteActionsFor(target: MatrixMenuTarget): DeleteAction[] {
  const {instrument, trackKey} = target;
  const instrumentLabel = INSTRUMENT_LABEL[instrument];
  const actions: DeleteAction[] = [];

  if (trackKey) {
    const label = trackLabel(trackKey);
    actions.push({
      label: 'Delete difficulty',
      title: `Delete ${label}?`,
      body: 'Removes this one track. Undoable.',
      toast: `Deleted ${label}.`,
      command: new DeleteTrackCommand(trackKey),
    });
  }

  if (target.hasLowerDifficulties) {
    actions.push({
      label: 'Delete all lower difficulties',
      title: `Delete ${instrumentLabel} Hard, Medium, Easy?`,
      body: 'Removes all three lower difficulties. Expert is not affected. Undoable.',
      toast: `Deleted ${instrumentLabel} Hard, Medium, Easy.`,
      command: new DeleteLowerDifficultiesCommand(instrument),
    });
  }

  actions.push({
    label: 'Delete instrument',
    title: `Delete ${instrumentLabel}?`,
    body: 'Removes every difficulty charted for this instrument. Undoable.',
    toast: `Deleted ${instrumentLabel}.`,
    command: new DeleteInstrumentCommand(instrument),
  });

  return actions;
}

export default function ChartMatrixContextMenu({
  target,
  onClose,
}: {
  target: MatrixMenuTarget;
  onClose: () => void;
}) {
  const {executeCommand} = useExecuteCommand();
  const [confirming, setConfirming] = useState<DeleteAction | null>(null);

  // This component is only mounted while the menu is open, so both dismissal
  // lifecycles are unconditionally active.
  useDismissOnEscape(true, onClose);
  useDismissOnOutsidePointerDown(true, onClose);

  const runDelete = useCallback(
    (action: DeleteAction) => {
      executeCommand(action.command);
      toast.success(action.toast);
      onClose();
    },
    [executeCommand, onClose],
  );

  if (confirming) {
    return (
      <ContextMenuPopover
        data-testid="chart-matrix-context-menu"
        x={target.x}
        y={target.y}
        anchor="fixed"
        minWidthPx={190}>
        <div className="px-3 py-2">
          <p className="mb-1 text-xs font-medium">{confirming.title}</p>
          <p className="mb-2 text-[11px] text-muted-foreground">
            {confirming.body}
          </p>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded px-2 py-1 text-xs hover:bg-accent"
              onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground hover:bg-destructive/90"
              onClick={() => runDelete(confirming)}>
              Delete
            </button>
          </div>
        </div>
      </ContextMenuPopover>
    );
  }

  return (
    <ContextMenuPopover
      data-testid="chart-matrix-context-menu"
      x={target.x}
      y={target.y}
      anchor="fixed"
      minWidthPx={190}
      items={deleteActionsFor(target).map(action => ({
        label: action.label,
        danger: true,
        onSelect: () => setConfirming(action),
      }))}
    />
  );
}
