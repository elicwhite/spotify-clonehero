/**
 * External store for the currently active assist run (plan 0074 Phase 1,
 * Design B). EditorSession-style (`lib/chart-editor-core/EditorSession.ts`):
 * a plain class with `getState`/`subscribe`, notifying listeners on every
 * state change. `useAssistRunner` drives it via `useSyncExternalStore` so a
 * progress tick re-renders only the run's own subscribers (the inline
 * `AssistRunCard`, the busy-marked matrix/piano-roll row headers) — never
 * the rest of the editor. One store instance holds at most one active run.
 */

import type {ProcessingStep} from '@/components/processing/StepRow';
import type {AssistTaskKey} from './tasks/types';

export type AssistRunStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'cancelled'
  | 'error';

export interface AssistRunState {
  task: AssistTaskKey | null;
  steps: ProcessingStep[];
  status: AssistRunStatus;
  error?: string | undefined;
}

export const IDLE_ASSIST_RUN_STATE: AssistRunState = {
  task: null,
  steps: [],
  status: 'idle',
};

export class AssistStore {
  private state: AssistRunState = IDLE_ASSIST_RUN_STATE;
  private readonly listeners = new Set<() => void>();

  getState = (): AssistRunState => this.state;

  /** Replaces the whole state and notifies subscribers. */
  setState = (next: AssistRunState): void => {
    this.state = next;
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
