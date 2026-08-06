'use client';

/**
 * Chart Assist "Drum transcription" card (plan 0074 Phase 2, Design C): the
 * staleness prompt, the "Keep as-is" dismissal, and the confirmed run of the
 * `transcribe-drums` task.
 *
 * The run is `transcribe-drums-from-audio` against the song mix the host
 * supplies and the chart already open: the drums are re-separated with
 * BS-Roformer through the shared stem cache (so a host that already has a
 * stem pays nothing for it) and snapped to the chart's OWN SyncTrack, which
 * the run never touches. Predicting a tempo map is the Tempo map card's
 * `generate-tempo-map` run and the user's own explicit choice; transcribing
 * drums never makes it for them. Any leading silence the user added is part
 * of that grid and survives the run for the same reason.
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
import {transcribeDrumsFromAudioTask} from '@/lib/assist/tasks/transcribe-drums-from-audio';
import type {LoadAssistAudio} from '@/lib/assist/tasks/types';
import {getAssistProvenance} from '@/lib/chart-editor-core';
import {
  findTrack,
  getDrumNotes,
  type ChartDocument,
  type DrumNote,
} from '@/lib/chart-edit';

import {useChartEditorContext} from '../ChartEditorContext';
import type {EditCommand} from '../commands';
import {ReplaceDrumTrackCommand} from '../commands';
import {CardAction, CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface DrumTranscriptionCardProps {
  doc: ChartDocument | null;
  stale: boolean;
  /** The song's audio. The run separates the drums back out of it and snaps
   *  them to the chart's own grid. */
  loadAudio: LoadAssistAudio | undefined;
  /**
   * Why this host can't start a run right now — it has no audio, or its
   * audio is being rebuilt. Set, the action is disabled with this text; the
   * staleness note and "Keep as-is" still work, since both are decisions
   * about the chart in the editor rather than pipeline work.
   */
  rerunDisabledReason?: string | undefined;
  runner: AssistRunnerControls;
  executeCommand: (command: EditCommand) => void;
  onLearnMore: (key: LearnKey) => void;
}

export default function DrumTranscriptionCard({
  doc,
  stale,
  loadAudio,
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
  const transcribed =
    getAssistProvenance(doc)?.tempoDerived?.['drum-transcription'] != null;
  const status = `${noteCount} notes on Drums · Expert`;

  // Fresh notes, and nothing else. They were snapped to the chart's own
  // grid, so the command is given no SyncTrack to adopt: the tempo map, the
  // time signatures and the leading-silence anchor are all left exactly as
  // the user has them, and a tempo edit made while the run was in flight
  // survives it. The command itself records the transcription's provenance.
  const applyResult = (result: {notes: DrumNote[]}) =>
    executeCommand(new ReplaceDrumTrackCommand(result.notes));

  const {running, run} = useAssistTaskRun(
    runner,
    transcribeDrumsFromAudioTask,
    {
      prepareInput: async () => {
        if (loadAudio === undefined || doc === null) {
          throw new Error('Drum transcription has no audio to transcribe');
        }
        return {audio: await loadAudio(), chartDoc: doc};
      },
      applyResult,
      successMessage: 'Transcribed drums.',
    },
  );

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
      icon={<Drum />}
      name="Drum transcription"
      status={status}
      aiLabel={transcribed ? 'AI-transcribed' : undefined}
      explanation="Writes a first-pass Expert drum chart from the audio, a faster starting point to tweak, not a finished chart."
      note={
        stale
          ? 'Tempo grid changed after transcription. The notes still sit where the old grid put them. Transcribe again to place them on the grid you have now. Your call.'
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
              label="Run"
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
            <AlertDialogTitle>Run drum transcription?</AlertDialogTitle>
            <AlertDialogDescription>
              This separates the drums out of the song and replaces the Expert
              drum chart. Your tempo map, your other instruments, and every edit
              outside Expert drums are left alone.
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
              Run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardShell>
  );
}
