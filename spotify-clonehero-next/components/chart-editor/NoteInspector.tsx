'use client';

import {useMemo} from 'react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {useChartEditorContext} from './ChartEditorContext';
import {useExecuteCommand} from './hooks/useEditCommands';
import {
  ToggleFlagCommand,
  DeleteNotesCommand,
  noteId,
  type FlagName,
} from './commands';
import type {
  DrumNote,
  DrumNoteType,
} from '@/lib/chart-edit';
import {getDrumNotes} from '@/lib/chart-edit';

const DRUM_TYPE_LABELS: Record<DrumNoteType, string> = {
  kick: 'Kick',
  redDrum: 'Snare',
  yellowDrum: 'Hi-Hat / Hi-Tom',
  blueDrum: 'Ride / Mid-Tom',
  greenDrum: 'Crash / Floor-Tom',
  fiveGreenDrum: '5-Lane Green',
};

const FLAG_ITEMS: {key: FlagName; label: string; shortcut: string}[] = [
  {key: 'cymbal', label: 'Cymbal', shortcut: 'Q'},
  {key: 'accent', label: 'Accent', shortcut: 'A'},
  {key: 'ghost', label: 'Ghost', shortcut: 'S'},
];

interface NoteInspectorProps {
  className?: string;
  /** Optional callback when notes are modified via this inspector. */
  onNotesModified?: (noteIds: string[]) => void;
}

/**
 * Panel that shows properties of the currently selected note(s).
 * Appears only when notes are selected in Cursor mode.
 */
export default function NoteInspector({className, onNotesModified}: NoteInspectorProps) {
  const {state, dispatch} = useChartEditorContext();
  const executeCommand = useExecuteCommand();

  const selectedNotes = useMemo(() => {
    if (!state.chartDoc) return [];
    const expertTrack = state.chartDoc.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (!expertTrack) return [];
    return getDrumNotes(expertTrack).filter(n =>
      state.selectedNoteIds.has(noteId(n)),
    );
  }, [state.chartDoc, state.selectedNoteIds]);

  if (selectedNotes.length === 0) return null;

  const isSingle = selectedNotes.length === 1;
  const firstNote = selectedNotes[0];

  // Determine aggregate flag state for the selection
  const flagStates = FLAG_ITEMS.map(({key}) => {
    const allTrue = selectedNotes.every(n => n.flags[key]);
    const someTrue = selectedNotes.some(n => n.flags[key]);
    return {key, allTrue, someTrue, indeterminate: someTrue && !allTrue};
  });

  const handleToggleFlag = (flag: FlagName) => {
    const ids = selectedNotes.map(n => noteId(n));
    executeCommand(new ToggleFlagCommand(ids, flag));
    onNotesModified?.(ids);
  };

  const handleDelete = () => {
    const ids = new Set(selectedNotes.map(n => noteId(n)));
    onNotesModified?.(Array.from(ids));
    executeCommand(new DeleteNotesCommand(ids));
    dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
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
          {isSingle ? 'Note Properties' : `${selectedNotes.length} Notes Selected`}
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
