import type {
  ChartDocument,
  ParsedTrackData,
  SelectableKind,
} from '@/lib/chart-edit';
import {findTrack} from '@/lib/chart-edit';
import type {InstrumentSchema} from '@/lib/chart-edit/instruments';
import {schemaForTrack} from '@/lib/chart-edit/instruments';
import {isTrackScope} from '@/components/chart-editor/scope';
import type {ChartEditorState} from './state';
import {EMPTY_STAMP, getAssistProvenance, isStampStale} from './content-stamps';
import type {TempoDerivedFeature} from './content-stamps';
import type {SupportedTrackInstrument, TrackKeyId} from './trackInventory';
import {UNSET_ORIGIN, type ChartOrigin} from '@/lib/project-storage/types';

/**
 * Which chart-authoring tool the open chart came from, for analytics
 * (plan 0105).
 *
 * A host that loads a project must publish it with `SET_CHART_ORIGIN`.
 * One that has not reports `UNSET_ORIGIN` rather than the editor: a wrong
 * attribution is invisible in a report, and a hole is not.
 */
export function selectReportedOrigin(state: ChartEditorState): ChartOrigin {
  return state.chartOrigin ?? UNSET_ORIGIN;
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Read the selection set for one entity kind. Always returns a stable empty
 *  set when the kind has no selection — never null. */
export function getSelectedIds(
  state: ChartEditorState,
  kind: SelectableKind,
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

/**
 * Resolve the `InstrumentSchema` for `state.activeScope`, honoring the
 * chart's `drumType` (4-lane vs 5-lane) via `schemaForTrack`. Returns null
 * for non-track scopes (`vocals`/`global`) or when the active track is
 * missing. Schemas are module singletons, so this needs no memoization.
 */
export function selectActiveSchema(
  state: ChartEditorState,
): InstrumentSchema | null {
  const track = selectActiveTrack(state);
  if (!track) return null;
  return schemaForTrack(track, state.chartDoc?.parsedChart.drumType);
}

// ---------------------------------------------------------------------------
// Staleness selectors (plan 0074 Design C)
// ---------------------------------------------------------------------------

/**
 * True when `feature`'s artifact was generated under a tempo map that no
 * longer matches the current one, and the user hasn't dismissed staleness for
 * the current tempo stamp via "Keep as-is". False when the feature has no
 * provenance (nothing to be stale about — hand-authored section titles and a
 * hand-charted drum track are nobody's recommendation to revisit) or when no
 * chart is loaded.
 */
export function selectTempoDerivedStale(
  state: ChartEditorState,
  feature: TempoDerivedFeature,
): boolean {
  const provenance = getAssistProvenance(state.chartDoc);
  const recorded = provenance?.tempoDerived?.[feature]?.tempoStamp;
  const acked = provenance?.acks?.[feature]?.ackStamp;
  return isStampStale(recorded, state.tempoStamp, acked);
}

/**
 * True when `instrument`'s generated difficulty tiers were sourced from a
 * track whose content stamp (`sourceTrackKeyId`) no longer matches, and the
 * user hasn't dismissed staleness for the current stamp. Shape is defined
 * for Phase 4 (`GenerateDifficultiesCommand`/matrix Re-generate); no caller
 * consumes this selector yet.
 */
export function selectDifficultyStale(
  state: ChartEditorState,
  instrument: SupportedTrackInstrument,
  sourceTrackKeyId: TrackKeyId,
): boolean {
  const provenance = getAssistProvenance(state.chartDoc);
  const recorded = provenance?.difficulties?.[instrument]?.sourceStamp;
  const acked = provenance?.acks?.[`difficulty:${instrument}`]?.ackStamp;
  // A missing stamp means the source track doesn't exist (deleted) —
  // `EMPTY_STAMP` can never equal a real stamp (16 hex chars), so this reads
  // as stale.
  const current = state.trackStamps[sourceTrackKeyId] ?? EMPTY_STAMP;
  return isStampStale(recorded, current, acked);
}
