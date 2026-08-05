'use client';

/**
 * Chart Assist per-instrument difficulty-regeneration recommendation (plan
 * 0074 Phase 4, Design C/D; plan 0076 items 8 and 9). Renders ONLY when
 * `selectDifficultyStale` fires for `instrument` (Expert edited after the
 * Hard/Medium/Easy set was generated) — the same condition that turns the
 * Chart Matrix row's tail amber. Both surfaces start the identical
 * `generate-difficulties` run; this card additionally offers
 * "Keep as-is", mirroring `DrumTranscriptionCard`'s dismissal (a reducer
 * action, not a command, so it neither lands on the undo stack nor discards
 * the redo branch), and "Delete Hard/Medium/Easy" behind the same confirm.
 * Delete lives here, alongside the staleness prompt, and nowhere else: it is
 * a rare action, and the moment a charter wants it is the moment the
 * generated set has gone stale.
 */

import {useCallback, useState} from 'react';
import {Sparkles, Trash2} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getAssistProvenance,
  LOWER_TRACK_DIFFICULTIES,
  type SupportedTrackInstrument,
} from '@/lib/chart-editor-core';
import {trackKeyId} from '../scope';
import {useChartEditorContext} from '../ChartEditorContext';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {DeleteLowerDifficultiesCommand} from '../commands';
import {useOptionalAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import {ConnectedAssistRunCard} from '@/components/assist/AssistRunCard';
import {useDifficultyGeneration} from '../hooks/useDifficultyGeneration';
import {INSTRUMENT_LABEL} from '../trackLabels';
import InstrumentIcon from '../InstrumentIcon';
import {CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface DifficultyGenerationCardProps {
  instrument: SupportedTrackInstrument;
  onLearnMore: (key: LearnKey) => void;
}

export default function DifficultyGenerationCard({
  instrument,
  onLearnMore,
}: DifficultyGenerationCardProps) {
  const {state, dispatch} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const runner = useOptionalAssistRunnerContext();
  const {generatingInstrument, disabledReason, start} =
    useDifficultyGeneration();
  const generating = generatingInstrument === instrument;
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const label = INSTRUMENT_LABEL[instrument];
  const sourceKey = trackKeyId({instrument, difficulty: 'expert'});
  const sourceStamp = state.trackStamps[sourceKey];

  const handleKeepAsIs = useCallback(() => {
    // No Expert stamp means the track this card is about isn't in
    // `trackStamps` — `selectDifficultyStale` treats that as stale, and
    // acking it with `EMPTY_STAMP` (which is what a `?? ''` fallback writes)
    // would equal the very value the selector substitutes and silence the
    // recommendation permanently. Nothing to acknowledge, so don't.
    if (sourceStamp === undefined) return;
    const prev = getAssistProvenance(state.chartDoc);
    dispatch({
      type: 'SET_ASSIST_PROVENANCE',
      provenance: {
        ...prev,
        acks: {
          ...prev?.acks,
          [`difficulty:${instrument}`]: {ackStamp: sourceStamp},
        },
      },
    });
    toast.success(`Kept existing ${label} difficulties`);
  }, [dispatch, state.chartDoc, instrument, sourceStamp, label]);

  // Deletes the generated set and drops its visibility keys, so a later
  // regeneration doesn't resurrect a pane the user never asked for — the
  // same behavior the removed matrix-row menu had.
  const handleDelete = useCallback(() => {
    executeCommand(new DeleteLowerDifficultiesCommand(instrument));
    for (const difficulty of LOWER_TRACK_DIFFICULTIES) {
      dispatch({
        type: 'SET_TRACK_VISIBILITY',
        track: {instrument, difficulty},
        visible: false,
      });
    }
    setConfirmDeleteOpen(false);
    toast.success(`Deleted ${label} Hard, Medium, Easy.`);
  }, [executeCommand, dispatch, instrument, label]);

  return (
    <CardShell
      icon={<InstrumentIcon instrument={instrument} size={14} />}
      name={`${label} difficulty`}
      explanation={`${label} Hard, Medium, and Easy were generated from an earlier version of Expert.`}
      note="Expert changed since these were generated. Generate again to match, or keep them. Your call."
      attn
      learnKey="difficulty"
      onLearnMore={onLearnMore}
      aiLabel="AI-generated from Expert"
      actions={
        generating ? null : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="default"
                    size="xs"
                    disabled={disabledReason !== undefined}
                    onClick={() => start(instrument)}>
                    <Sparkles />
                    Generate
                  </Button>
                </span>
              </TooltipTrigger>
              {disabledReason !== undefined && (
                <TooltipContent side="right">{disabledReason}</TooltipContent>
              )}
            </Tooltip>
            <Button variant="ghost" size="xs" onClick={handleKeepAsIs}>
              Keep as-is
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDeleteOpen(true)}>
              <Trash2 />
              Delete
            </Button>
          </>
        )
      }>
      {generating && runner && (
        // Gated on THIS card's own `generating` flag, not just the task key:
        // the assist runner is shared editor-wide, and another instrument's
        // row/card can be mid-run on the same 'generate-difficulties' task
        // while this one sits idle-and-stale.
        <ConnectedAssistRunCard
          store={runner.store}
          task="generate-difficulties"
          onCancel={runner.cancel}
          onDismiss={runner.dismiss}
        />
      )}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {label} Hard, Medium, and Easy?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the generated Hard, Medium, and Easy difficulties for{' '}
              {label}. Expert is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardShell>
  );
}
