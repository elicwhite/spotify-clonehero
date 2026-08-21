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
import {AudioWaveform} from 'lucide-react';
import {toast} from 'sonner';

import {ConnectedAssistRunCard} from '@/components/assist/AssistRunCard';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import {useAssistTaskRun} from '../hooks/useAssistTaskRun';
import {addLeadingSilenceTask} from '@/lib/assist/tasks/add-leading-silence';
import type {AddLeadingSilenceResult} from '@/lib/assist/tasks/add-leading-silence';
import type {ChartDocument} from '@/lib/chart-edit';
import {detectLeadingSilenceRecommendation} from '@/lib/chart-edit/leading-silence-detector';

import {usePadAudioAheadReader} from '../AudioServiceContext';
import type {EditCommand} from '../commands';
import {AddLeadingSilenceCommand} from '../commands';
import {CardAction, CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface LeadingSilenceCardProps {
  doc: ChartDocument;
  runner: AssistRunnerControls;
  audioSampleRate: number;
  audioBusyReason: string | undefined;
  detectedAudioOnsetMs: number | undefined;
  executeCommand: (command: EditCommand) => void;
  onLearnMore: (key: LearnKey) => void;
}

export default function LeadingSilenceCard({
  doc,
  runner,
  audioSampleRate,
  audioBusyReason,
  detectedAudioOnsetMs,
  executeCommand,
  onLearnMore,
}: LeadingSilenceCardProps) {
  const getPadAudioAhead = usePadAudioAheadReader();
  const recommendation = detectLeadingSilenceRecommendation(
    doc,
    detectedAudioOnsetMs === undefined ? null : {onsetMs: detectedAudioOnsetMs},
  );

  // The run reads the doc rather than closing over it: a run takes about a
  // second, and the plan it applies has to describe the chart at the end of
  // that second, not the render that started it.
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const {running, run} = useAssistTaskRun(runner, addLeadingSilenceTask, {
    prepareInput: useCallback(
      async () => ({
        readDoc: () => docRef.current,
        sampleRate: audioSampleRate,
        padAudioAhead: getPadAudioAhead() ?? undefined,
      }),
      [audioSampleRate, getPadAudioAhead],
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
    successMessage: ({plan}: AddLeadingSilenceResult) =>
      plan === null
        ? null
        : `Added ${(plan.padMs / 1000).toFixed(1)}s (${plan.bars} bar${
            plan.bars === 1 ? '' : 's'
          }) of leading silence`,
  });

  return (
    <CardShell
      icon={<AudioWaveform />}
      name="Add leading silence"
      explanation="Adds silence before the first note so the chart starts on a full measure."
      note={recommendation?.detail}
      attn={recommendation !== null}
      learnKey="silence"
      onLearnMore={onLearnMore}
      actions={
        running ? null : (
          <CardAction
            disabledReason={audioBusyReason}
            onClick={run}
            icon={AudioWaveform}
            label="Add leading silence"
            variant={recommendation !== null ? 'default' : 'outline'}
          />
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
