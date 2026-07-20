import {chartEditorReducer} from './reducer';
import type {ChartEditorAction, ChartEditorState} from './state';
import {initialState} from './state';

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
 */
export class EditorSession {
  private state: ChartEditorState;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Partial<ChartEditorState> = {}) {
    this.state = {...initialState, ...initial};
  }

  getState = (): ChartEditorState => this.state;

  dispatch = (action: ChartEditorAction): void => {
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
