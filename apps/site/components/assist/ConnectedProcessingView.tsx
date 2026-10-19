'use client';

/**
 * `ProcessingView` subscribed to an assist run store — the full-page shell's
 * one connector (plan 0074 Design B: "one renderer, two shells").
 *
 * Every host that renders a run's step list mounts this instead of calling
 * `useAssistRunState` itself, because that hook re-renders its caller on
 * every progress tick: subscribing at a page root would re-render the whole
 * page several times a second. This leaf is the only thing that re-renders.
 *
 * Steps render only while the active run belongs to `taskKey`, so a runner
 * shared with another surface (the editor's Regenerate control, an
 * escalation pass) never shows its steps here.
 */

import ProcessingView, {
  type ProcessingViewProps,
} from '@/components/ProcessingView';
import type {AssistStore} from '@/lib/assist/assist-store';
import type {AssistTaskKey} from '@/lib/assist/tasks/types';
import {useAssistRunState} from './useAssistRunner';

export interface ConnectedProcessingViewProps
  extends Omit<ProcessingViewProps, 'steps'> {
  store: AssistStore;
  /** Whose steps to render. */
  taskKey: AssistTaskKey;
}

export default function ConnectedProcessingView({
  store,
  taskKey,
  ...viewProps
}: ConnectedProcessingViewProps) {
  const state = useAssistRunState(store);
  return (
    <ProcessingView
      {...viewProps}
      steps={state.task === taskKey ? state.steps : []}
    />
  );
}
