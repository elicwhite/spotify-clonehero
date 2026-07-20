import {chartEditorReducer} from './reducer';
import type {ChartEditorAction, ChartEditorState} from './state';
import {initialState} from './state';
import {isCommandAllowed} from './capabilityGate';
import type {EditorCapabilities} from '@/components/chart-editor/capabilities';
import {DRUM_EDIT_CAPABILITIES} from '@/components/chart-editor/capabilities';

/**
 * Headless, React-free editor store. Holds the reducer state and notifies
 * subscribers on every dispatch, so it can be driven by
 * `useSyncExternalStore` (see `ChartEditorProvider`) without any React
 * dependency living in this module — commands, tests, and future non-React
 * consumers (e.g. `EditorMCPTools`) can dispatch against it directly.
 *
 * `dispatch` always produces a new snapshot object when the reducer returns
 * a different reference; reducer branches that bail out (`return state`)
 * skip the notify, matching `useReducer`'s behavior.
 *
 * `capabilities` gates `EXECUTE_COMMAND`: a command whose declared
 * `entityKinds`/`operations` (plan 0037 Task 3) aren't fully covered by the
 * session's capability preset is rejected outright — the dispatch is a
 * silent no-op, exactly like a reducer branch that returns the same state.
 * This is a second, independent enforcement layer under the existing UI
 * gating (`EditorCapabilities.selectable`/`draggable`, etc. in
 * `useHighwayMouseInteraction`) — callers that bypass the UI (tests,
 * `EditorMCPTools`, future scripting) still can't dispatch a command their
 * page's capability preset doesn't allow.
 */
export class EditorSession {
  private state: ChartEditorState;
  private readonly listeners = new Set<() => void>();
  private readonly capabilities: EditorCapabilities;

  constructor(
    initial: Partial<ChartEditorState> = {},
    capabilities: EditorCapabilities = DRUM_EDIT_CAPABILITIES,
  ) {
    this.state = {...initialState, ...initial};
    this.capabilities = capabilities;
  }

  getState = (): ChartEditorState => this.state;

  dispatch = (action: ChartEditorAction): void => {
    if (
      action.type === 'EXECUTE_COMMAND' &&
      !isCommandAllowed(action.command, this.capabilities)
    ) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `EditorSession: rejected "${action.command.description}" — ` +
            "command declares entity kinds/operations outside this page's " +
            'EditorCapabilities preset.',
        );
      }
      return;
    }
    const next = chartEditorReducer(this.state, action);
    if (next === this.state) return;
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
