'use client';

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {HotkeysProvider} from '@tanstack/react-hotkeys';
import {EditorSession, selectActiveSchema} from '@/lib/chart-editor-core';
import type {ChartEditorContextValue} from '@/lib/chart-editor-core';
import type {InstrumentSchema} from '@/lib/chart-edit/instruments';
import type {EditorCapabilities} from './capabilities';
import {DRUM_EDIT_CAPABILITIES} from './capabilities';
import type {EditorScope} from './scope';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from './scope';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ChartEditorContext = createContext<ChartEditorContextValue | null>(null);

export function ChartEditorProvider({
  children,
  capabilities = DRUM_EDIT_CAPABILITIES,
  activeScope = DEFAULT_DRUMS_EXPERT_SCOPE,
}: {
  children: ReactNode;
  capabilities?: EditorCapabilities;
  /** What the editor is editing. Pages pin this once at mount. */
  activeScope?: EditorScope;
}) {
  // One EditorSession per provider mount — the headless store this adapter
  // subscribes to via useSyncExternalStore. `activeScope`/`capabilities` are
  // provider props read once at mount (existing behavior: neither was ever
  // re-derived from a prop change).
  const [session] = useState(
    () => new EditorSession({activeScope}, capabilities),
  );

  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  const reconcilerRef = useRef<
    import('@/lib/preview/highway/SceneReconciler').SceneReconciler | null
  >(null);
  const noteRendererRef = useRef<
    import('@/lib/preview/highway/NoteRenderer').NoteRenderer | null
  >(null);

  const value = useMemo<ChartEditorContextValue>(
    () => ({
      state,
      dispatch: session.dispatch,
      reconcilerRef,
      noteRendererRef,
      capabilities,
    }),
    [state, session, capabilities],
  );

  return (
    <HotkeysProvider>
      <ChartEditorContext.Provider value={value}>
        {children}
      </ChartEditorContext.Provider>
    </HotkeysProvider>
  );
}

export function useChartEditorContext(): ChartEditorContextValue {
  const ctx = useContext(ChartEditorContext);
  if (!ctx) {
    throw new Error(
      'useChartEditorContext must be used within a ChartEditorProvider',
    );
  }
  return ctx;
}

/**
 * The `InstrumentSchema` for the current `activeScope`, honoring the
 * chart's `drumType`. Null for non-track scopes (`vocals`/`global`) or
 * before a chart is loaded. Schemas are module singletons — no
 * memoization needed, `selectActiveSchema` runs on every render.
 */
export function useActiveSchema(): InstrumentSchema | null {
  const {state} = useChartEditorContext();
  return selectActiveSchema(state);
}
