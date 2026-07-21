'use client';

import {useMemo} from 'react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {useChartEditorContext} from './ChartEditorContext';
import {
  getSelectedIds,
  selectActiveTrack,
  selectActiveSchema,
} from '@/lib/chart-editor-core';
import {trackKeyFromScope} from './scope';
import {useExecuteCommand} from './hooks/useEditCommands';
import {
  ToggleFlagCommand,
  ToggleKickCommand,
  DeleteNotesCommand,
  noteId,
} from './commands';
import {
  drums4LaneSchema,
  listNotes,
  type NoteFlagName,
  type InstrumentSchema,
} from '@/lib/chart-edit';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import type {NoteType} from '@eliwhite/scan-chart';

/** Friendly label for a `NoteType`, from `schema.lanes[].label`. */
function typeLabel(schema: InstrumentSchema, type: NoteType): string {
  return schema.lanes.find(l => l.noteType === type)?.label ?? String(type);
}

/** Flag items shown in the inspector, derived from `schema.flagBindings`.
 *  Only flags with a keyboard shortcut surface here; flags without one
 *  (e.g. drums' flam, doubleKick) live on the schema but aren't bound to a
 *  UI button. */
function flagItemsForSchema(
  schema: InstrumentSchema,
): {key: NoteFlagName; label: string; shortcut: string}[] {
  return schema.flagBindings
    .filter(b => b.defaultKey !== undefined)
    .map(b => ({
      key: b.flag,
      label: b.label,
      shortcut: b.defaultKey!.toUpperCase(),
    }));
}

interface NoteInspectorProps {
  className?: string | undefined;
}

/**
 * Panel that shows properties of the currently selected note(s).
 * Appears only when notes are selected in Cursor mode.
 */
export default function NoteInspector({className}: NoteInspectorProps) {
  const {state, dispatch} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();

  const schema = selectActiveSchema(state) ?? drums4LaneSchema;
  const flagItems = flagItemsForSchema(schema);
  const hasKickLane = schema.lanes.some(l => l.noteType === noteTypes.kick);

  const selectedNotes = useMemo(() => {
    const track = selectActiveTrack(state);
    if (!track) return [];
    const activeSchema = selectActiveSchema(state) ?? drums4LaneSchema;
    const selected = getSelectedIds(state, 'note');
    return listNotes(track, activeSchema).filter(n => selected.has(noteId(n)));
  }, [state]);

  if (selectedNotes.length === 0) return null;

  const isSingle = selectedNotes.length === 1;
  const firstNote = selectedNotes[0];

  // Determine aggregate flag state for the selection
  const flagStates = flagItems.map(({key}) => {
    const allTrue = selectedNotes.every(n => n.flags & noteFlags[key]);
    const someTrue = selectedNotes.some(n => n.flags & noteFlags[key]);
    return {key, allTrue, someTrue, indeterminate: someTrue && !allTrue};
  });

  // Note inspector only mounts when notes are selected, which only happens
  // in track scopes — so trackKey is always defined here.
  const trackKey = trackKeyFromScope(state.activeScope);
  if (!trackKey) return null;

  const handleToggleFlag = (flag: NoteFlagName) => {
    const ids = selectedNotes.map(n => noteId(n));
    executeCommand(new ToggleFlagCommand(ids, flag, trackKey, schema));
  };

  const handleDelete = () => {
    const ids = new Set(selectedNotes.map(n => noteId(n)));
    executeCommand(new DeleteNotesCommand(ids, trackKey));
    dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
  };

  // Kick conversion works like the tom/cymbal toggle: pads convert to kick;
  // an all-kick selection converts back to snare. (Dragging can't cross the
  // kick/pad boundary — this button is the only mouse path.) Drum-only:
  // gated on `hasKickLane` above, since kick has no non-drum equivalent.
  const allKick = selectedNotes.every(n => n.type === noteTypes.kick);
  const handleToggleKick = () => {
    const ids = selectedNotes.map(n => noteId(n));
    executeCommand(new ToggleKickCommand(ids, trackKey));
    // Note ids encode the type, so conversion renames them. Re-select the
    // converted notes under their new ids (collision-skipped notes keep
    // their old id and naturally stay selected either way).
    const targetType = allKick ? noteTypes.redDrum : noteTypes.kick;
    dispatch({
      type: 'SET_SELECTION',
      kind: 'note',
      ids: new Set(
        selectedNotes.map(n => {
          const newType =
            !allKick && n.type === noteTypes.kick ? n.type : targetType;
          return noteId({tick: n.tick, type: newType});
        }),
      ),
    });
  };

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
          <p className="font-medium">{typeLabel(schema, firstNote.type)}</p>
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
                {} as Record<number, number>,
              ),
            ).map(([type, count]) => (
              <span
                key={type}
                className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {typeLabel(schema, Number(type) as NoteType)} x{count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Flags */}
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Flags</span>
        <div className="flex gap-1">
          {hasKickLane && (
            <Button
              variant={allKick ? 'secondary' : 'outline'}
              size="sm"
              className={cn(
                'h-7 px-2 text-xs',
                allKick && 'ring-1 ring-primary',
              )}
              onClick={handleToggleKick}
              title={allKick ? 'Convert kick to snare' : 'Convert to kick'}>
              Kick
            </Button>
          )}
          {flagStates.map(({key, allTrue, indeterminate}) => {
            // Hide a flag button when none of the selected notes' types
            // are legal for it (e.g. cymbal on an all-red/kick selection).
            const flagItem = flagItems.find(f => f.key === key)!;
            const binding = schema.flagBindings.find(b => b.flag === key);
            const applicable =
              !binding?.appliesTo ||
              selectedNotes.some(n => binding.appliesTo!.includes(n.type));
            if (!applicable) return null;

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
