import type {
  ChartDocument,
  EntityKind,
  ParsedTrackData,
} from '@/lib/chart-edit';
import {findTrack} from '@/lib/chart-edit';
import {isTrackScope} from '@/components/chart-editor/scope';
import type {ChartEditorState} from './state';

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Read the selection set for one entity kind. Always returns a stable empty
 *  set when the kind has no selection — never null. */
export function getSelectedIds(
  state: ChartEditorState,
  kind: EntityKind,
): ReadonlySet<string> {
  return state.selection.get(kind) ?? EMPTY_SET;
}

/** True when at least one entity of any kind is selected. */
export function isAnythingSelected(state: ChartEditorState): boolean {
  for (const set of state.selection.values()) {
    if (set.size > 0) return true;
  }
  return false;
}

/** First selected id of a kind, or null. Useful for kinds where the editor
 *  only ever holds one selected at a time (e.g. sections today). */
export function getFirstSelectedId(
  state: ChartEditorState,
  kind: EntityKind,
): string | null {
  const set = state.selection.get(kind);
  if (!set || set.size === 0) return null;
  for (const id of set) return id;
  return null;
}

// ---------------------------------------------------------------------------
// Scope selectors
// ---------------------------------------------------------------------------

/**
 * The chart document both views RENDER from (plan 0061 §7 — the one preview
 * channel). When a tempo gesture is uncommitted, `pendingTempoCandidate.doc`
 * is drawn in BOTH the highway and the piano-roll timeline; otherwise the
 * committed `chartDoc` is. Editing still targets the committed `chartDoc` — this
 * selector only chooses what is drawn, and both views call it so they can never
 * disagree about which doc is on screen.
 */
export function selectRenderDoc(state: ChartEditorState): ChartDocument | null {
  return state.pendingTempoCandidate?.doc ?? state.chartDoc;
}

/**
 * Resolve the `ParsedTrackData` slice referenced by `state.activeScope`.
 * Returns null when the scope is `vocals` / `global` or when the named
 * track doesn't exist in the document.
 */
export function selectActiveTrack(
  state: ChartEditorState,
): ParsedTrackData | null {
  const doc = state.chartDoc;
  if (!doc) return null;
  if (!isTrackScope(state.activeScope)) return null;
  return findTrack(doc, state.activeScope.track)?.track ?? null;
}
