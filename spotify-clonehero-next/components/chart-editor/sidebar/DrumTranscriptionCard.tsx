'use client';

/**
 * Chart Assist "Drum transcription" card (plan 0074 Phase 2, Design C): the
 * staleness prompt, the "Keep as-is" dismissal, and the confirmed run of the
 * `transcribe-drums` task.
 *
 * The run takes whichever of the two shapes the host is wired for. A
 * project-backed host (`/drum-transcription`) regenerates its OPFS project,
 * which re-predicts the tempo map along with the notes. Any other host runs
 * `transcribe-drums-from-audio` against the song mix it supplies and the
 * chart already open, whose SyncTrack stays put. Both re-separate the drums
 * with BS-Roformer through the shared stem cache, so neither depends on the
 * host having a separated stem to hand and the action is never dead for
 * want of one.
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
import {
  transcribeDrumsTask,
  type TranscribeDrumsSync,
} from '@/lib/assist/tasks/transcribe-drums';
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
  /** The OPFS drum-transcription project to regenerate, when the host has
   *  one. It takes precedence over {@link loadAudio}: regenerating also
   *  re-predicts that project's tempo map and rewrites its pipeline state,
   *  which an audio-only run has nowhere to put. */
  projectId: string | undefined;
  /** The song's audio, for a host with no drum-transcription project. The
   *  run separates the drums back out of it and snaps them to the chart's
   *  own grid. */
  loadAudio: LoadAssistAudio | undefined;
  /**
   * Why this host can't start a run right now — it has neither a project nor
   * any audio, or its audio is being rebuilt. Set, the action is disabled
   * with this text; the staleness note and "Keep as-is" still work, since
   * both are decisions about the chart in the editor rather than pipeline
   * work.
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

  // Both runs land the same way: fresh notes plus the grid they were
  // authored against. The run rebuilt the chart from audio, so the old
  // leading-silence anchor no longer describes it (0064 addendum §1). The
  // command itself records the transcription's provenance.
  const applyResult = (result: {
    notes: DrumNote[];
    sync: TranscribeDrumsSync;
  }) =>
    executeCommand(
      new ReplaceDrumTrackCommand(result.notes, {
        sync: result.sync,
        clearAudioAnchor: true,
      }),
    );

  // Two runs, one CTA. Which one fires is decided at click time by the
  // wiring the host gave this card; the hooks are unconditional because
  // hooks are, and each only builds callbacks.
  const projectRun = useAssistTaskRun(runner, transcribeDrumsTask, {
    prepareInput: async () => {
      if (projectId === undefined) {
        throw new Error('Drum transcription has no project to regenerate');
      }
      // Regenerating a project recomputes its tempo map and notes together
      // and replaces both.
      return {run: {kind: 'regenerate' as const, projectId}};
    },
    applyResult,
    successMessage: 'Beat grid and notes written.',
  });

  const audioRun = useAssistTaskRun(runner, transcribeDrumsFromAudioTask, {
    prepareInput: async () => {
      if (loadAudio === undefined || doc === null) {
        throw new Error('Drum transcription has no audio to transcribe');
      }
      return {audio: await loadAudio(), chartDoc: doc};
    },
    applyResult,
    successMessage: 'Transcribed drums.',
  });

  const active = projectId !== undefined ? projectRun : audioRun;
  const running = active.running;
  const run = active.run;

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
          ? 'Tempo grid changed after transcription. Transcribe again if the grid moved where drums land. Your call.'
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
              {projectId !== undefined
                ? 'This re-predicts the beat grid and the notes from the audio. All note edits and review progress for this project will be discarded.'
                : 'This separates the drums out of the song and replaces the Expert drum chart. Your tempo map, your other instruments, and every edit outside Expert drums are left alone.'}
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
