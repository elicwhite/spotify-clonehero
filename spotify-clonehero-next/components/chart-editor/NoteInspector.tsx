'use client';

import {useMemo} from 'react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {
  useChartEditorContext,
  getSelectedIds,
  selectActiveTrack,
} from './ChartEditorContext';
import {trackKeyFromScope} from './scope';
import {useExecuteCommand} from './hooks/useEditCommands';
import {
  ToggleFlagCommand,
  DeleteNotesCommand,
  noteId,
  type FlagName,
} from './commands';
import type {DrumNoteType} from '@/lib/chart-edit';
import {getDrumNotes, drums4LaneSchema} from '@/lib/chart-edit';

const DRUM_TYPE_LABELS: Record<DrumNoteType, string> = {
  kick: 'Kick',
  redDrum: 'Snare',
  yellowDrum: 'Hi-Hat / Hi-Tom',
  blueDrum: 'Ride / Mid-Tom',
  greenDrum: 'Crash / Floor-Tom',
  fiveGreenDrum: '5-Lane Green',
};

// Flag items shown in the inspector are derived from the drum schema.
// Only flags with a keyboard shortcut surface here; flags without one
// (e.g. flam, doubleKick) live on the schema but aren't bound to a UI button.
const FLAG_ITEMS: {key: FlagName; label: string; shortcut: string}[] =
  drums4LaneSchema.flagBindings
    .filter(b => b.defaultKey !== undefined)
    .map(b => ({
      key: b.flag as FlagName,
      label: b.label,
      shortcut: b.defaultKey!.toUpperCase(),
    }));

interface NoteInspectorProps {
  className?: string;
  /** Optional callback when notes are modified via this inspector. */
  onNotesModified?: (noteIds: string[]) => void;
}

/**
 * Panel that shows properties of the currently selected note(s).
 * Appears only when notes are selected in Cursor mode.
 */
export default function NoteInspector({
  className,
  onNotesModified,
}: NoteInspectorProps) {
  const {state, dispatch} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();

  const selectedNotes = useMemo(() => {
    const track = selectActiveTrack(state);
    if (!track) return [];
    const selected = getSelectedIds(state, 'note');
    return getDrumNotes(track).filter(n => selected.has(noteId(n)));
  }, [state]);

  if (selectedNotes.length === 0) return null;

  const isSingle = selectedNotes.length === 1;
  const firstNote = selectedNotes[0];

  // Determine aggregate flag state for the selection
  const flagStates = FLAG_ITEMS.map(({key}) => {
    const allTrue = selectedNotes.every(n => n.flags[key]);
    const someTrue = selectedNotes.some(n => n.flags[key]);
    return {key, allTrue, someTrue, indeterminate: someTrue && !allTrue};
  });

  // Note inspector only mounts when notes are selected, which only happens
  // in track scopes — so trackKey is always defined here.
  const trackKey = trackKeyFromScope(state.activeScope);
  if (!trackKey) return null;

  const handleToggleFlag = (flag: FlagName) => {
    const ids = selectedNotes.map(n => noteId(n));
    executeCommand(new ToggleFlagCommand(ids, flag, trackKey));
    onNotesModified?.(ids);
  };

  const handleDelete = () => {
    const ids = new Set(selectedNotes.map(n => noteId(n)));
    onNotesModified?.(Array.from(ids));
    executeCommand(new DeleteNotesCommand(ids, trackKey));
    dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
  };

  // Check if cymbal is applicable (only for yellow/blue/green)
  const hasCymbalApplicable = selectedNotes.some(n =>
    ['yellowDrum', 'blueDrum', 'greenDrum'].includes(n.type),
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-background p-3 text-sm',
        className,
      )}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">
          {isSingle
            ? 'Note Properties'
            : `${selectedNotes.length} Notes Selected`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
          onClick={handleDelete}>
          Delete
        </Button>
      </div>

      {/* Type display */}
      {isSingle && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Type</span>
          <p className="font-medium">{DRUM_TYPE_LABELS[firstNote.type]}</p>
        </div>
      )}

      {/* Tick position */}
      {isSingle && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Tick</span>
          <p className="font-mono text-xs">{firstNote.tick}</p>
        </div>
      )}

      {/* Type breakdown for multi-select */}
      {!isSingle && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Types</span>
          <div className="flex flex-wrap gap-1">
            {Object.entries(
              selectedNotes.reduce(
                (acc, n) => {
                  acc[n.type] = (acc[n.type] || 0) + 1;
                  return acc;
                },
                {} as Record<string, number>,
              ),
            ).map(([type, count]) => (
              <span
                key={type}
                className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {DRUM_TYPE_LABELS[type as DrumNoteType]} x{count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Flags */}
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Flags</span>
        <div className="flex gap-1">
          {flagStates.map(({key, allTrue, indeterminate}) => {
            // Hide cymbal button if not applicable
            if (key === 'cymbal' && !hasCymbalApplicable) return null;

            const flagItem = FLAG_ITEMS.find(f => f.key === key)!;
            return (
              <Button
                key={key}
                variant={allTrue ? 'secondary' : 'outline'}
                size="sm"
                className={cn(
                  'h-7 px-2 text-xs',
                  indeterminate && 'opacity-60',
                  allTrue && 'ring-1 ring-primary',
                )}
                onClick={() => handleToggleFlag(key)}
                title={`${flagItem.label} (${flagItem.shortcut})`}>
                {flagItem.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
