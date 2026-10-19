'use client';

/**
 * Inline shell for an `AssistRunState` (plan 0074 Design B: one renderer,
 * two shells). The steps themselves render through the same
 * `components/processing/StepRow.tsx` that `ProcessingView` uses, at
 * `compact` density — this shell only supplies what differs: it sits inside
 * an already-expanded Chart Assist card, so it drops the outer `Card`/title
 * chrome and carries its own cancel/dismiss affordances.
 */

import {AlertCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import StepRow from '@/components/processing/StepRow';
import type {AssistRunState, AssistStore} from '@/lib/assist/assist-store';
import type {AssistTaskKey} from '@/lib/assist/tasks/types';
import {useAssistRunState} from './useAssistRunner';

export interface AssistRunCardProps {
  state: AssistRunState;
  onCancel?: (() => void) | undefined;
  /** Clears a failed run's card. Successful and cancelled runs clear
   *  themselves after a short flash, so only errors need the affordance. */
  onDismiss?: (() => void) | undefined;
  /** Render only while this task is the active run. Every surface shares one
   *  runner, so a card without this would also light up for a run started
   *  somewhere else in the editor. */
  task?: AssistTaskKey | undefined;
  className?: string | undefined;
}

export default function AssistRunCard({
  state,
  onCancel,
  onDismiss,
  task,
  className,
}: AssistRunCardProps) {
  if (state.status === 'idle') return null;
  if (task !== undefined && state.task !== task) return null;

  return (
    <div className={cn('space-y-3', className)}>
      <ol aria-label="Progress steps" className="space-y-2.5">
        {state.steps.map(step => (
          <li key={step.key}>
            <StepRow step={step} density="compact" />
          </li>
        ))}
      </ol>

      {state.status === 'error' && state.error && (
        <p className="text-xs text-destructive flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}

      {state.status === 'cancelled' && (
        <p className="text-xs text-muted-foreground">Cancelled.</p>
      )}

      {state.status === 'running' && onCancel && (
        <div className="flex justify-end">
          {/* `xs`, not `sm`: `sm` only shrinks height, its label stays the
           *  base `text-sm` (14px) - visibly larger than the `text-xs` step
           *  rows and "Cancelled." copy this button sits beside (plan 0076
           *  item 7). `xs` is the button scale already reserved for assist
           *  card action rows (`components/ui/button.tsx`). */}
          <Button variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      {state.status === 'error' && onDismiss && (
        <div className="flex justify-end">
          <Button variant="ghost" size="xs" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

export interface ConnectedAssistRunCardProps {
  store: AssistStore;
  onCancel?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
  task?: AssistTaskKey | undefined;
  className?: string | undefined;
}

/**
 * `AssistRunCard` subscribed to a run store. This is the only component that
 * re-renders on a progress tick, which is why hosts hold the run via
 * `useAssistRunnerControls` and hand the store down instead of reading the
 * state themselves (plan 0074 Design B: progress must not re-render the
 * editor).
 */
export function ConnectedAssistRunCard({
  store,
  onCancel,
  onDismiss,
  task,
  className,
}: ConnectedAssistRunCardProps) {
  const state = useAssistRunState(store);
  return (
    <AssistRunCard
      state={state}
      onCancel={onCancel}
      onDismiss={onDismiss}
      task={task}
      className={className}
    />
  );
}
