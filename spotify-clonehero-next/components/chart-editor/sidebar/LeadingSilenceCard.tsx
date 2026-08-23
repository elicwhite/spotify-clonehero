'use client';

/**
 * Chart Assist "Add leading silence" card: runs the `add-leading-silence`
 * task on the editor's shared assist runner and applies the plan it
 * measures with `AddLeadingSilenceCommand`.
 *
 * The measuring is chart math and is instant. Padding the AUDIO to match is
 * not — every track gets a fresh buffer the length of the whole song — so the
 * task does that in a worker, ahead of the command, and the card reports it
 * as a step like every other assist action.
 */

import {useCallback, useEffect, useRef} from 'react';
import {AudioWaveform, Crosshair} from 'lucide-react';
import {toast} from 'sonner';

import {ConnectedAssistRunCard} from '@/components/assist/AssistRunCard';
import {getAudioAnchor, getLeadIn, getSongStart} from '@/lib/chart-edit';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import {useAssistTaskRun} from '../hooks/useAssistTaskRun';
import {addLeadingSilenceTask} from '@/lib/assist/tasks/add-leading-silence';
import type {AddLeadingSilenceResult} from '@/lib/assist/tasks/add-leading-silence';
import type {ChartDocument} from '@/lib/chart-edit';

import {
  useOptionalAudioManager,
  usePadAudioAheadReader,
} from '../AudioServiceContext';
import type {EditCommand} from '../commands';
import {AddLeadingSilenceCommand, SetSongStartCommand} from '../commands';
import {CardAction, CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface LeadingSilenceCardProps {
  doc: ChartDocument;
  runner: AssistRunnerControls;
  audioBusyReason: string | undefined;
  executeCommand: (command: EditCommand) => void;
  onLearnMore: (key: LearnKey) => void;
}

export default function LeadingSilenceCard({
  doc,
  runner,
  audioBusyReason,
  executeCommand,
  onLearnMore,
}: LeadingSilenceCardProps) {
  const getPadAudioAhead = usePadAudioAheadReader();
  const audioManager = useOptionalAudioManager();

  // The pad is measured from the song start, and nothing but the user can
  // supply it (plan 0124 step 4). Until it is set, the action is offered but
  // disabled, and the card is highlighted so the user knows why.
  const songStart = getSongStart(doc);
  const leadInBars = getLeadIn(doc)?.bars ?? null;
  const needsSongStart = songStart === null;

  // The run reads the doc rather than closing over it: a run takes about a
  // second, and the plan it applies has to describe the chart at the end of
  // that second, not the render that started it.
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  /** Record the song start at the playhead, in ORIGINAL-audio ms — the pad
   *  sits in front of the audio, so chart time is the pad plus audio time. */
  const setSongStartHere = useCallback(() => {
    const chartMs = Math.max(0, (audioManager?.chartTime ?? 0) * 1000);
    const padMs = getAudioAnchor(docRef.current)?.ms ?? 0;
    executeCommand(new SetSongStartCommand(Math.max(0, chartMs - padMs)));
  }, [audioManager, executeCommand]);

  const {running, run} = useAssistTaskRun(runner, addLeadingSilenceTask, {
    prepareInput: useCallback(
      async () => ({
        readDoc: () => docRef.current,
        padAudioAhead: getPadAudioAhead() ?? undefined,
        // A card that has never been used asks for the minimum; a later press
        // adds one more bar.
        bars:
          getLeadIn(docRef.current) === null
            ? undefined
            : getLeadIn(docRef.current)!.bars + 1,
      }),
      [getPadAudioAhead],
    ),
    applyResult: useCallback(
      ({plan}: AddLeadingSilenceResult) => {
        if (!plan) {
          toast.info('No leading silence needed');
          return;
        }
        executeCommand(new AddLeadingSilenceCommand(plan));
      },
      [executeCommand],
    ),
    successMessage: ({plan}: AddLeadingSilenceResult) => {
      if (plan === null) return null;
      const dropped = plan.droppedTempos + plan.droppedTimeSignatures;
      // The pad is the WHOLE silence in front of the audio, so the message
      // states the lead-in rather than an amount added. Removing the tempo
      // map's own lead-in markers is part of the edit, so it is named.
      return (
        `Lead-in: ${plan.bars} bar${plan.bars === 1 ? '' : 's'}` +
        ` (${(plan.padMs / 1000).toFixed(1)}s of silence)` +
        (dropped > 0
          ? `, and ${dropped} marker${dropped === 1 ? '' : 's'} before the song start removed`
          : '')
      );
    },
  });

  return (
    <CardShell
      icon={<AudioWaveform />}
      name="Add leading silence"
      explanation="Adds whole bars of silence in front of the audio, so the song starts on a bar line."
      note={
        needsSongStart
          ? 'Put the playhead on the song\u2019s first downbeat, then set the song start.'
          : leadInBars === null
            ? undefined
            : `Lead-in: ${leadInBars} bar${leadInBars === 1 ? '' : 's'}.`
      }
      attn={needsSongStart}
      learnKey="silence"
      onLearnMore={onLearnMore}
      actions={
        running ? null : (
          <>
            <CardAction
              disabledReason={audioBusyReason}
              onClick={setSongStartHere}
              icon={Crosshair}
              label="Set song start"
              variant={needsSongStart ? 'default' : 'outline'}
            />
            <CardAction
              disabledReason={
                audioBusyReason ??
                (needsSongStart ? 'Set where the song starts' : undefined)
              }
              onClick={run}
              icon={AudioWaveform}
              label={leadInBars === null ? 'Add leading silence' : 'Add a bar'}
              variant="outline"
            />
          </>
        )
      }>
      <ConnectedAssistRunCard
        store={runner.store}
        task="add-leading-silence"
        onCancel={runner.cancel}
        onDismiss={runner.dismiss}
      />
    </CardShell>
  );
}
