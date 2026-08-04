'use client';

/**
 * Chart Assist "Sections" card (plan 0076 item 23): runs the
 * `generate-sections` task and installs its labels with
 * `ReplaceSectionsCommand`.
 *
 * Sections are their own artifact, generated on their own — a tempo-map
 * regeneration no longer rewrites them. What it DOES do is move the grid the
 * labels were placed against, which is what the staleness note and the
 * "Keep as-is" dismissal are for: the same recommendation-not-a-fact pattern
 * the Drum transcription card established.
 */

import {useCallback} from 'react';
import {ListMusic, RefreshCw} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {ConnectedAssistRunCard} from '@/components/assist/AssistRunCard';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import {useAssistTaskRun} from '@/components/assist/useAssistTaskRun';
import {generateSectionsTask} from '@/lib/assist/tasks/generate-sections';
import type {LoadAssistAudio} from '@/lib/assist/tasks/types';
import {getAssistProvenance} from '@/lib/chart-editor-core';
import type {ChartDocument} from '@/lib/chart-edit';

import {useChartEditorContext} from '../ChartEditorContext';
import type {EditCommand} from '../commands';
import {ReplaceSectionsCommand} from '../commands';
import {CardAction, CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface SectionsCardProps {
  doc: ChartDocument | null;
  stale: boolean;
  runner: AssistRunnerControls;
  loadAudio: LoadAssistAudio;
  audioBusyReason: string | undefined;
  executeCommand: (command: EditCommand) => void;
  onLearnMore: (key: LearnKey) => void;
}

export default function SectionsCard({
  doc,
  stale,
  runner,
  loadAudio,
  audioBusyReason,
  executeCommand,
  onLearnMore,
}: SectionsCardProps) {
  const {dispatch, state} = useChartEditorContext();

  const sectionCount = doc ? doc.parsedChart.sections.length : 0;
  // Only a chart whose sections this task produced may claim an AI origin
  // (hand-written section titles are the charter's work), and a chart whose
  // markers were all deleted by hand has none left to claim whatever the
  // provenance stamp still says.
  const generated =
    sectionCount > 0 &&
    getAssistProvenance(doc)?.tempoDerived?.sections != null;
  // Sections in the chart that this task didn't produce: hand-written titles
  // a re-generate would overwrite.
  const authored = !generated && sectionCount > 0;
  // Staleness is about markers sitting on the wrong bars, so it means
  // nothing once there are no markers left.
  const showStale = stale && sectionCount > 0;
  const status = sectionCount === 1 ? '1 section' : `${sectionCount} sections`;

  const {running, run} = useAssistTaskRun(runner, generateSectionsTask, {
    prepareInput: async () => ({audio: await loadAudio()}),
    applyResult: result => {
      if (!result.sections || result.sections.labels.length === 0) {
        toast.error("Couldn't find any section boundaries in this song.");
        return;
      }
      executeCommand(new ReplaceSectionsCommand(result.sections));
    },
    successMessage: 'Sections generated',
  });

  // A dismissal is a decision about a recommendation, not a chart edit, so it
  // goes straight to the reducer rather than onto the undo stack.
  const handleKeepAsIs = useCallback(() => {
    const prev = getAssistProvenance(state.chartDoc);
    dispatch({
      type: 'SET_ASSIST_PROVENANCE',
      provenance: {
        ...prev,
        acks: {...prev?.acks, sections: {ackStamp: state.tempoStamp}},
      },
    });
    toast.success('Kept existing sections');
  }, [dispatch, state.chartDoc, state.tempoStamp]);

  return (
    <CardShell
      icon={<ListMusic />}
      name="Sections"
      status={status}
      aiLabel={generated ? 'AI-labeled' : undefined}
      explanation="Finds where the song changes and names the parts: intro, verse, chorus."
      note={
        showStale
          ? 'Tempo grid changed after these sections were made. They may sit on the wrong bars now. Your call.'
          : // Sections this task never made are the charter's own work, and
            // generating replaces all of them, so say so before the click
            // rather than leaving undo as the only signal.
            authored
            ? 'This chart already has section titles you wrote. Generating replaces all of them (undo brings them back).'
            : undefined
      }
      attn={showStale}
      learnKey="sections"
      onLearnMore={onLearnMore}
      actions={
        running ? null : (
          <>
            <CardAction
              disabledReason={audioBusyReason}
              onClick={run}
              icon={RefreshCw}
              label={sectionCount === 0 ? 'Generate sections' : 'Re-generate'}
              variant={showStale ? 'default' : 'outline'}
            />
            {showStale && (
              <Button variant="ghost" size="xs" onClick={handleKeepAsIs}>
                Keep as-is
              </Button>
            )}
          </>
        )
      }>
      <ConnectedAssistRunCard
        store={runner.store}
        task="generate-sections"
        onCancel={runner.cancel}
        onDismiss={runner.dismiss}
      />
    </CardShell>
  );
}
