'use client';

/**
 * "Add Leading Silence" button (plan 0064 editor-button addendum §5). Pads
 * the chart's opening with whole lead-in bars at the real tempo/TS by
 * shifting every event's ms-domain position — see
 * `lib/chart-edit/leading-silence.ts` for the full mechanics. The stored
 * audio at rest is never touched; EditorApp is responsible for padding the
 * in-memory PCM (waveform/AudioManager) and the export path in response to
 * the resulting `audioAnchor`.
 */

import {useCallback} from 'react';
import {Rewind} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {useChartEditorContext} from '@/components/chart-editor/ChartEditorContext';
import {useExecuteCommand} from '@/components/chart-editor/hooks/useEditCommands';
import type {EditCommand} from '@/components/chart-editor/commands';
import {
  planLeadingSilence,
  applyLeadingSilence,
  type ChartDocument,
  type LeadingSilencePlan,
} from '@/lib/chart-edit';

/**
 * Apply a leading-silence plan captured at click time. `execute` re-derives
 * nothing from the live doc — the plan is a snapshot of what the button
 * offered the user, so redo (re-running `execute` on the doc left by undo)
 * reproduces the exact same padding. Undo restores the pre-edit snapshot,
 * matching the other tempo/anchor-affecting commands in commands.ts (the
 * ms-domain shift + resync isn't invertible in closed form).
 */
class AddLeadingSilenceCommand implements EditCommand {
  readonly description: string;
  private prevDoc: ChartDocument | null = null;

  constructor(private plan: LeadingSilencePlan) {
    this.description = `Add leading silence (${plan.bars} bar${plan.bars === 1 ? '' : 's'})`;
  }

  execute(doc: ChartDocument): ChartDocument {
    this.prevDoc = doc;
    return applyLeadingSilence(doc, this.plan);
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
  }
}

interface LeadingSilenceButtonProps {
  /** The audio's sample rate, for sample-quantizing the pad amount. */
  sampleRate: number;
  /** Disable while EditorApp is rebuilding the padded AudioManager. */
  disabled?: boolean;
}

export default function LeadingSilenceButton({
  sampleRate,
  disabled,
}: LeadingSilenceButtonProps) {
  const {state} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();

  const handleClick = useCallback(() => {
    if (!state.chartDoc) return;
    const plan = planLeadingSilence(state.chartDoc, sampleRate);
    if (!plan) {
      toast.info('No leading silence needed');
      return;
    }
    executeCommand(new AddLeadingSilenceCommand(plan));
    const seconds = (plan.padMs / 1000).toFixed(1);
    toast.success(
      `Added ${seconds}s (${plan.bars} bar${plan.bars === 1 ? '' : 's'}) of leading silence`,
    );
  }, [state.chartDoc, sampleRate, executeCommand]);

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full gap-2"
      disabled={disabled}
      onClick={handleClick}>
      <Rewind className="h-4 w-4" />
      Add Leading Silence
    </Button>
  );
}
