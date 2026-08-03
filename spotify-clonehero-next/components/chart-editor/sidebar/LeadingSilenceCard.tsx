'use client';

/**
 * Chart Assist "Add leading silence" card (plan 0074 Phase 2).
 *
 * Calls `planLeadingSilence` (plan 0064) DIRECTLY and applies
 * `AddLeadingSilenceCommand`, not through the assist engine: it's synchronous
 * chart math with no worker, no ML model, and nothing to report progress on
 * — wrapping a sub-millisecond operation in `AssistRunState`'s
 * running/steps/cancel machinery would be pure ceremony.
 */

import {useCallback} from 'react';
import {AudioWaveform} from 'lucide-react';
import {toast} from 'sonner';

import {planLeadingSilence, type ChartDocument} from '@/lib/chart-edit';
import {detectLeadingSilenceRecommendation} from '@/lib/chart-edit/leading-silence-detector';

import type {EditCommand} from '../commands';
import {AddLeadingSilenceCommand} from '../commands';
import {CardAction, CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface LeadingSilenceCardProps {
  doc: ChartDocument;
  audioSampleRate: number;
  audioBusyReason: string | undefined;
  /**
   * A STANDING reason this host can't add leading silence, even though the
   * detector's advice is still worth showing. Padding the chart is only half
   * the operation: the host also has to pad the audio it plays and exports
   * (`usePaddedAudio`), and a host that can't leaves the chart and the audio
   * drifted apart. Set, the action is disabled with this text and the card
   * still renders its recommendation.
   */
  disabledReason?: string | undefined;
  detectedAudioOnsetMs: number | undefined;
  executeCommand: (command: EditCommand) => void;
  onLearnMore: (key: LearnKey) => void;
}

export default function LeadingSilenceCard({
  doc,
  audioSampleRate,
  audioBusyReason,
  disabledReason,
  detectedAudioOnsetMs,
  executeCommand,
  onLearnMore,
}: LeadingSilenceCardProps) {
  const recommendation = detectLeadingSilenceRecommendation(
    doc,
    detectedAudioOnsetMs === undefined ? null : {onsetMs: detectedAudioOnsetMs},
  );

  const handleClick = useCallback(() => {
    const plan = planLeadingSilence(doc, audioSampleRate);
    if (!plan) {
      toast.info('No leading silence needed');
      return;
    }
    executeCommand(new AddLeadingSilenceCommand(plan));
    const seconds = (plan.padMs / 1000).toFixed(1);
    toast.success(
      `Added ${seconds}s (${plan.bars} bar${plan.bars === 1 ? '' : 's'}) of leading silence`,
    );
  }, [doc, audioSampleRate, executeCommand]);

  return (
    <CardShell
      icon={AudioWaveform}
      name="Add leading silence"
      explanation="Gives the song a count-in so the grid and first notes line up."
      note={recommendation?.detail}
      attn={recommendation !== null}
      learnKey="silence"
      onLearnMore={onLearnMore}>
      <CardAction
        disabledReason={disabledReason ?? audioBusyReason}
        onClick={handleClick}
        icon={AudioWaveform}
        label="Add leading silence"
        variant={recommendation !== null ? 'default' : 'outline'}
      />
    </CardShell>
  );
}
