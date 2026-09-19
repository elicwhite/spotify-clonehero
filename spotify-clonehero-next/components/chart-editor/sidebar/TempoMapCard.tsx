'use client';

/**
 * Chart Assist "Tempo map" card (plan 0074 Phase 2): runs the
 * `generate-tempo-map` task on the host's audio and installs the resulting
 * grid with `ReplaceTempoMapCommand`.
 */

import {Clock, RefreshCw} from 'lucide-react';

import {ConnectedAssistRunCard} from '@/components/assist/AssistRunCard';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import {useAssistTaskRun} from '../hooks/useAssistTaskRun';
import {generateTempoMapTask} from '@/lib/assist/tasks/generate-tempo-map';
import type {LoadAssistAudio} from '@/lib/assist/tasks/types';

import type {EditCommand} from '../commands';
import {ReplaceTempoMapCommand} from '../commands';
import {CardAction, CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';
import {
  webGpuFp16Note,
  webGpuFp16Tooltip,
  type WebGpuFp16Status,
} from '@/lib/onnx/webgpu-capability';

export interface TempoMapCardProps {
  runner: AssistRunnerControls;
  loadAudio: LoadAssistAudio;
  audioBusyReason: string | undefined;
  /** Why this computer cannot run the separation the tempo map needs, or
   *  null when it can (and while the probe is still in flight). */
  webGpuBlocked: Exclude<WebGpuFp16Status, 'ok'> | null;
  executeCommand: (command: EditCommand) => void;
  onLearnMore: (key: LearnKey) => void;
}

export default function TempoMapCard({
  runner,
  loadAudio,
  audioBusyReason,
  webGpuBlocked,
  executeCommand,
  onLearnMore,
}: TempoMapCardProps) {
  const {running, run} = useAssistTaskRun(runner, generateTempoMapTask, {
    prepareInput: async () => ({audio: await loadAudio()}),
    applyResult: result =>
      executeCommand(new ReplaceTempoMapCommand(result.synctrack)),
    successMessage: 'Tempo map generated',
  });

  // A standing limit of this computer outranks a transient one: an audio
  // rebuild ends in seconds, a graphics card that cannot run the model does
  // not, so the reason the user reads is the one that will still be true.
  const disabledReason =
    webGpuBlocked !== null ? webGpuFp16Tooltip(webGpuBlocked) : audioBusyReason;

  return (
    <CardShell
      icon={<Clock />}
      name="Tempo map"
      explanation="Builds the grid every note snaps to. A rough first pass, so check the downbeat and the meter."
      note={
        webGpuBlocked !== null
          ? webGpuFp16Note(
              webGpuBlocked,
              'Can’t run on this computer: it separates the drums first, and that model needs a graphics-card feature this one doesn’t have. It’s the card, not a setting.',
            )
          : undefined
      }
      noteTone="muted"
      learnKey="tempo"
      onLearnMore={onLearnMore}
      actions={
        running ? null : (
          <CardAction
            disabledReason={disabledReason}
            onClick={run}
            icon={RefreshCw}
            label="Generate tempo map"
          />
        )
      }>
      {/* The run card renders itself only while this task's run is the
       *  active one, and keeps a terminal message (error, "Cancelled.") on
       *  screen for a moment after. The action returns as soon as the run
       *  stops, so a cancelled run can be restarted without waiting for the
       *  message to clear. */}
      <ConnectedAssistRunCard
        store={runner.store}
        task="generate-tempo-map"
        onCancel={runner.cancel}
        onDismiss={runner.dismiss}
      />
    </CardShell>
  );
}
