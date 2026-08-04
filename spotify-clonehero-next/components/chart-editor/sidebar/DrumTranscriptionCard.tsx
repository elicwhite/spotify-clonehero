'use client';

/**
 * Chart Assist "Drum transcription" card (plan 0074 Phase 2, Design C): the
 * staleness prompt, the "Keep as-is" dismissal, and the confirmed re-run of
 * the `transcribe-drums` task.
 */

import {useCallback, useState} from 'react';
import {Drum, RefreshCw} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
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
import {ConnectedAssistRunCard} from '@/components/assist/AssistRunCard';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import {useAssistTaskRun} from '@/components/assist/useAssistTaskRun';
import {transcribeDrumsTask} from '@/lib/assist/tasks/transcribe-drums';
import {getAssistProvenance} from '@/lib/chart-editor-core';
import {findTrack, getDrumNotes, type ChartDocument} from '@/lib/chart-edit';

import {useChartEditorContext} from '../ChartEditorContext';
import type {EditCommand} from '../commands';
import {ReplaceDrumTrackCommand} from '../commands';
import {CardAction, CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface DrumTranscriptionCardProps {
  doc: ChartDocument | null;
  stale: boolean;
  /** The OPFS drum-transcription project the re-run regenerates. Undefined
   *  only together with `rerunDisabledReason`. */
  projectId: string | undefined;
  /**
   * A STANDING reason this host can't re-run transcription (no
   * drum-transcription project behind the chart, so there is no separated
   * drum stem and no pipeline state to regenerate). Set, the re-run action
   * is disabled with this text; the staleness note and "Keep as-is" still
   * work, since both are decisions about the chart in the editor rather than
   * pipeline work.
   */
  rerunDisabledReason?: string | undefined;
  runner: AssistRunnerControls;
  executeCommand: (command: EditCommand) => void;
  onLearnMore: (key: LearnKey) => void;
}

export default function DrumTranscriptionCard({
  doc,
  stale,
  projectId,
  rerunDisabledReason,
  runner,
  executeCommand,
  onLearnMore,
}: DrumTranscriptionCardProps) {
  const {dispatch, state} = useChartEditorContext();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const drumsTrack = doc
    ? findTrack(doc, {instrument: 'drums', difficulty: 'expert'})?.track
    : null;
  const noteCount = drumsTrack ? getDrumNotes(drumsTrack).length : 0;
  // Only a chart that actually carries a transcription record may be
  // described as AI-transcribed. A hand-authored chart opened in an editor
  // that offers this card is still just someone's chart.
  const transcribed = getAssistProvenance(doc)?.drumTranscription != null;
  const status = `${noteCount} notes on Drums · Expert`;

  const {running, run} = useAssistTaskRun(runner, transcribeDrumsTask, {
    prepareInput: async () => {
      if (projectId === undefined) {
        throw new Error(
          rerunDisabledReason ?? 'Drum transcription has no project to re-run',
        );
      }
      // Re-running from inside the editor means regenerating this project:
      // the tempo map and notes are recomputed and replace what is there.
      return {run: {kind: 'regenerate' as const, projectId}};
    },
    // The run rebuilt the chart from audio, so the old leading-silence anchor
    // no longer describes it (0064 addendum §1). The command itself records
    // the transcription's provenance.
    applyResult: result =>
      executeCommand(
        new ReplaceDrumTrackCommand(result.notes, {
          sync: result.sync,
          clearAudioAnchor: true,
        }),
      ),
    successMessage: 'Regenerated beat grid and notes.',
  });

  // "Keep as-is" is a decision about a recommendation, not a chart edit, so
  // it goes straight to the reducer instead of through a command: an
  // undoable "Update assist provenance" entry would both clutter the undo
  // stack and discard the user's redo branch (plan 0074 Design C).
  const handleKeepAsIs = useCallback(() => {
    const prev = getAssistProvenance(state.chartDoc);
    dispatch({
      type: 'SET_ASSIST_PROVENANCE',
      provenance: {
        ...prev,
        acks: {
          ...prev?.acks,
          'drum-transcription': {ackStamp: state.tempoStamp},
        },
      },
    });
    toast.success('Kept existing transcription');
  }, [dispatch, state.chartDoc, state.tempoStamp]);

  return (
    <CardShell
      icon={Drum}
      name="Drum transcription"
      status={status}
      aiLabel={transcribed ? 'AI-transcribed' : undefined}
      explanation="Turns the drum audio into an Expert drum chart automatically."
      note={
        stale
          ? 'Tempo grid changed after transcription. Re-run if the grid moved where drums land. Your call.'
          : undefined
      }
      attn={stale}
      learnKey="drums"
      onLearnMore={onLearnMore}
      actions={
        running ? null : (
          <>
            <CardAction
              disabledReason={rerunDisabledReason}
              onClick={() => setConfirmOpen(true)}
              icon={RefreshCw}
              label={noteCount === 0 ? 'Transcribe' : 'Re-run'}
              variant={stale ? 'default' : 'outline'}
            />
            {stale && (
              <Button variant="ghost" size="xs" onClick={handleKeepAsIs}>
                Keep as-is
              </Button>
            )}
          </>
        )
      }>
      <ConnectedAssistRunCard
        store={runner.store}
        task="transcribe-drums"
        onCancel={runner.cancel}
        onDismiss={runner.dismiss}
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run drum transcription?</AlertDialogTitle>
            <AlertDialogDescription>
              This re-runs the beat grid and predicted notes from the cached
              audio. All note edits and review progress for this project will be
              discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                run();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Re-run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardShell>
  );
}
