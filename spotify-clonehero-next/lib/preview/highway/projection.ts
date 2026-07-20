/**
 * EditorProjection — the renderer contract (plan 0038).
 *
 * `buildProjectionFor(scope, doc, schema)` turns an `EditorScope` + the
 * editable `ChartDocument` into everything a view (highway, piano-roll)
 * needs to render: the active instrument's lane geometry, the note
 * elements for the scoped track, the chart-wide + vocal-part markers
 * (sections/lyrics/phrases/BPM/time-signatures), a flattened timing
 * summary, and a slot for transient overlays (selection/hover/drag
 * preview) that views push in separately.
 *
 * This module only assembles the projection from existing converters
 * (`trackToElements`, `buildMarkerElements`) — it introduces no new
 * element kinds and changes no rendering behavior. `lib/preview/highway`
 * call sites migrate onto it in later 0038 tasks.
 */

import type {ParsedChart} from '../chorus-chart-processing';
import type {ChartDocument} from '@/lib/chart-edit';
import type {EditorScope} from '@/components/chart-editor/scope';
import {resolveScopeTrack} from '@/components/chart-editor/scope';
import type {InstrumentSchema, LaneDefinition} from '@/lib/chart-edit';
import type {ChartElement} from './SceneReconciler';
import {trackToElements} from './trackToElements';
import {buildMarkerElements} from './chartToElements';
import type {Track} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A transient, non-persisted visual overlay (selection highlight, hover
 * highlight, drag preview). Distinct from `elements`/`markers`, which are
 * derived purely from the chart document: overlays are derived from
 * editor-session state (selection set, hover anchor, in-flight drag) that
 * `buildProjectionFor` has no access to, so it always returns an empty
 * array. Views push overlay state into the renderer directly (e.g.
 * `SceneReconciler.setSelected`/`setHovered`) — this field exists so the
 * `EditorProjection` shape has a slot for that once overlays move to a
 * declarative push, without forcing that migration in this task.
 */
export interface OverlayElement {
  /** Unique key, same identity scheme as `ChartElement.key`. */
  key: string;
  /** Overlay kind — determines which renderer handles it. */
  kind: 'selection' | 'hover' | 'drag-preview';
  /** Arbitrary data passed to the renderer. */
  data: unknown;
}

/** A single flattened tempo (BPM) change. */
export interface TimingTempo {
  tick: number;
  msTime: number;
  beatsPerMinute: number;
}

/** A single flattened time-signature change. */
export interface TimingTimeSignature {
  tick: number;
  msTime: number;
  numerator: number;
  denominator: number;
}

/** Chart-wide tempo map + time-signature map, flattened for consumers that
 *  don't want to walk `ParsedChart` directly (e.g. the piano-roll tempo
 *  lane). */
export interface TimingProjection {
  tempos: TimingTempo[];
  timeSignatures: TimingTimeSignature[];
}

/**
 * The renderer contract: everything a view needs to render one scope of
 * one `ChartDocument`.
 */
export interface EditorProjection {
  /** Lane geometry for the active instrument (empty for vocals/global scopes). */
  lanes: LaneDefinition[];
  /** Note elements for the scoped track (empty for vocals/global scopes). */
  elements: ChartElement[];
  /** Chart-wide + vocal-part markers: sections, lyrics, phrases, BPM, time signatures. */
  markers: ChartElement[];
  /** Transient overlays (selection/hover/drag preview). Always empty today — see {@link OverlayElement}. */
  overlays: OverlayElement[];
  /** Flattened tempo + time-signature maps. */
  timing: TimingProjection;
}

// ---------------------------------------------------------------------------
// buildProjectionFor
// ---------------------------------------------------------------------------

function buildTiming(parsedChart: ParsedChart): TimingProjection {
  return {
    tempos: parsedChart.tempos.map(t => ({
      tick: t.tick,
      msTime: t.msTime,
      beatsPerMinute: t.beatsPerMinute,
    })),
    timeSignatures: parsedChart.timeSignatures.map(ts => ({
      tick: ts.tick,
      msTime: ts.msTime,
      numerator: ts.numerator,
      denominator: ts.denominator,
    })),
  };
}

const EMPTY_PROJECTION: EditorProjection = {
  lanes: [],
  elements: [],
  markers: [],
  overlays: [],
  timing: {tempos: [], timeSignatures: []},
};

/**
 * Builds the `EditorProjection` for `scope` against `doc`.
 *
 * `schema` is the active instrument's `InstrumentSchema` — pass `null` for
 * `vocals`/`global` scopes, which have no lane geometry (`schemaForTrack`
 * already returns `null` for instruments without a schema). `doc` is
 * `null` before a chart has loaded; callers get the empty projection back
 * in that case.
 *
 * `vocalPartName` selects which vocal part's lyrics/phrases contribute to
 * `markers`; defaults to `scope.part` for `vocals` scopes, else `'vocals'`.
 */
export function buildProjectionFor(
  scope: EditorScope,
  doc: ChartDocument | null,
  schema: InstrumentSchema | null,
): EditorProjection {
  if (!doc) return EMPTY_PROJECTION;

  const track = resolveScopeTrack(doc, scope);
  const elements = track ? trackToElements(track as unknown as Track) : [];

  const vocalPartName = scope.kind === 'vocals' ? scope.part : 'vocals';
  const markers = buildMarkerElements(doc.parsedChart, vocalPartName);

  return {
    lanes: schema?.lanes ?? [],
    elements,
    markers,
    overlays: [],
    timing: buildTiming(doc.parsedChart),
  };
}
