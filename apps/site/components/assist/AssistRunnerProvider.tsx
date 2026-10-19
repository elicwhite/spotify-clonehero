'use client';

/**
 * The editor's single assist runner (plan 0074 Design B). Mounted beside
 * `ChartEditorProvider`, it owns one `useAssistRunnerControls` for the whole
 * editor, so every surface that can start a pipeline run (the Regenerate
 * control, the Add Lyrics dialog, and the Chart Assist cards that follow)
 * shares one active-run slot and one `AbortController`: a second run is
 * refused while one is in flight, and unmounting the editor aborts whatever
 * is running.
 *
 * The context value is referentially stable, and the run state itself lives
 * in the store rather than in context, so consuming this never re-renders a
 * component on a progress tick.
 */

import {createContext, useContext, type ReactNode} from 'react';
import {
  useAssistRunnerControls,
  type AssistRunnerControls,
} from './useAssistRunner';

const AssistRunnerContext = createContext<AssistRunnerControls | null>(null);

export function AssistRunnerProvider({children}: {children: ReactNode}) {
  const controls = useAssistRunnerControls();
  return (
    <AssistRunnerContext.Provider value={controls}>
      {children}
    </AssistRunnerContext.Provider>
  );
}

/** The editor's assist runner, or null outside an `AssistRunnerProvider`.
 *  For surfaces that render in both worlds: a bare `ChartEditorProvider`
 *  (capability-gate tests, pages that haven't adopted the engine) has no
 *  provider, and such a surface hides its run-starting controls rather than
 *  failing to mount. */
export function useOptionalAssistRunnerContext(): AssistRunnerControls | null {
  return useContext(AssistRunnerContext);
}

/** The editor's assist runner. Throws outside an `AssistRunnerProvider` —
 *  a surface that can start a run must share the editor's single runner. */
export function useAssistRunnerContext(): AssistRunnerControls {
  const controls = useContext(AssistRunnerContext);
  if (!controls) {
    throw new Error(
      'useAssistRunnerContext must be used inside an AssistRunnerProvider',
    );
  }
  return controls;
}
