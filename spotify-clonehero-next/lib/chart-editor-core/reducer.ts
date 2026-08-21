import type {
  ChartDocument,
  DownbeatFlags,
  SelectableKind,
} from '@/lib/chart-edit';
import {chartEndTick, deriveDownbeatFlags} from '@/lib/chart-edit';
import type {ChartEditorAction, ChartEditorState} from './state';
import {UNDO_STACK_CAP} from './state';
import {
  parseTrackKeyId,
  preferredTrackForChart,
  trackKeyId,
} from './trackInventory';
import {
  computeAllTrackStamps,
  computeTempoStamp,
  recomputeTrackStamps,
  withAssistProvenance,
} from './content-stamps';

/** True when two selection sets hold exactly the same ids (or both are
 *  empty), so `SET_SELECTION_MULTI` can skip a no-op kind. */
function sameIdSet(
  a: ReadonlySet<string> | undefined,
  b: ReadonlySet<string>,
): boolean {
  if (a === b) return true;
  const size = a?.size ?? 0;
  if (size !== b.size) return false;
  if (!a) return true;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function recoverTrackScope(
  chartDoc: ChartDocument,
  scope: ChartEditorState['activeScope'],
): ChartEditorState['activeScope'] {
  if (scope.kind !== 'track') return scope;
  const currentId = trackKeyId(scope.track);
  if (
    chartDoc.parsedChart.trackData.some(
      track => trackKeyId(track) === currentId,
    )
  ) {
    return scope;
  }
  const fallback = preferredTrackForChart(chartDoc);
  return fallback
    ? {
        kind: 'track',
        track: {
          instrument: fallback.instrument as typeof scope.track.instrument,
          difficulty: fallback.difficulty as typeof scope.track.difficulty,
        },
      }
    : scope;
}

/**
 * Drop visible-track ids the doc no longer contains. `AddTrackCommand` and
 * its undo change which tracks exist, while visibility is separate state;
 * without this, undoing an "Add instrument" leaves a highway pane mounted
 * for a track that no longer exists and that the Chart Matrix — which only
 * renders rows for present instruments — can no longer hide.
 *
 * A drop that empties the set entirely falls back to the doc's preferred
 * track, so no command can leave the editor with nothing on screen. Only
 * that *transition* triggers the fallback: an already-empty set is a
 * legitimate user state (`SET_TRACK_VISIBILITY` deliberately lets the user
 * hide the final row), so an edit made while everything is hidden must not
 * unhide a row the user never asked for.
 *
 * Returns the original set when nothing was dropped, so unaffected edits
 * keep their reference identity.
 */
function reconcileVisibleTracks(
  chartDoc: ChartDocument,
  visible: ReadonlySet<string>,
): ReadonlySet<string> {
  const existing = new Set(
    chartDoc.parsedChart.trackData.map(track => trackKeyId(track)),
  );
  const next = new Set<string>();
  for (const id of visible) {
    if (existing.has(id)) next.add(id);
  }
  if (next.size === visible.size) return visible;
  if (next.size === 0) {
    const fallback = preferredTrackForChart(chartDoc);
    if (fallback) next.add(trackKeyId(fallback));
  }
  return next;
}

/**
 * The doc-derived slice every doc-replacing action (`EXECUTE_COMMAND`,
 * `UNDO`, `REDO`) writes identically: the new doc, the active scope and
 * visible-track ids reconciled against it, its downbeat flags, and a
 * cleared tempo preview — any pending candidate was derived from the doc
 * being replaced, so rendering or committing it now would desync the views
 * from the undo stack (0061 §7).
 *
 * `visible` defaults to the current visible set; `UNDO`/`REDO` pass the
 * snapshot they popped so a restored track comes back visible if it was
 * visible when the edit ran.
 *
 * Content stamps are deliberately NOT here: the three actions each need a
 * different stamp rule (see their cases).
 */
function applyDocToState(
  state: ChartEditorState,
  chartDoc: ChartDocument,
  visible: ReadonlySet<string> = state.visibleTrackKeys,
): Pick<
  ChartEditorState,
  | 'chartDoc'
  | 'activeScope'
  | 'visibleTrackKeys'
  | 'downbeatFlags'
  | 'pendingTempoCandidate'
> {
  return {
    chartDoc,
    activeScope: recoverTrackScope(chartDoc, state.activeScope),
    visibleTrackKeys: reconcileVisibleTracks(chartDoc, visible),
    downbeatFlags: computeDownbeatFlags(chartDoc),
    pendingTempoCandidate: null,
  };
}

/**
 * Recompute the downbeat-flag store from a doc's `timeSignatures` (0061 §3b
 * load direction). Called on every doc change so the store is always a pure
 * function of the chart — the "one store, incapable of desync" invariant.
 * A null doc (nothing loaded) keeps the tick-0 default.
 */
function computeDownbeatFlags(doc: ChartDocument | null): DownbeatFlags {
  if (!doc) return {downbeats: [{tick: 0, denominator: 4}]};
  const chart = doc.parsedChart;
  return deriveDownbeatFlags(
    chart.timeSignatures,
    chart.resolution,
    chartEndTick(chart),
  );
}

/** @internal — exported for unit tests in `__tests__/reducer.test.ts`. */
export function chartEditorReducer(
  state: ChartEditorState,
  action: ChartEditorAction,
): ChartEditorState {
  switch (action.type) {
    case 'SET_CHART_DOC': {
      const preferred = preferredTrackForChart(action.chartDoc);
      return {
        ...state,
        chartDoc: action.chartDoc,
        downbeatFlags: computeDownbeatFlags(action.chartDoc),
        // A chart (re)load resets the glue toggle to audio-glued (0062 §9,
        // deliberately not persisted) and drops any in-flight tempo preview.
        tempoGlueMode: 'audio',
        pendingTempoCandidate: null,
        activeScope: recoverTrackScope(action.chartDoc, state.activeScope),
        // Start the unified editor with one visible row. Keeping this as an
        // explicit set, rather than treating an empty set as an implicit
        // fallback, lets the user hide the final visible row too.
        visibleTrackKeys: preferred
          ? new Set([trackKeyId(preferred)])
          : new Set(),
        // A full reload has no continuity with the previous doc's stamps —
        // recompute everything fresh (plan 0074 Design C).
        trackStamps: computeAllTrackStamps(action.chartDoc),
        tempoStamp: computeTempoStamp(action.chartDoc),
      };
    }
    case 'SET_PLAYING':
      if (state.isPlaying === action.isPlaying) return state;
      return {...state, isPlaying: action.isPlaying};
    case 'SET_CURRENT_TIME':
      if (state.currentTimeMs === action.timeMs) return state;
      return {...state, currentTimeMs: action.timeMs};
    case 'SET_PLAYBACK_SPEED':
      return {...state, playbackSpeed: action.speed};
    case 'SET_ZOOM':
      return {...state, zoom: action.zoom};
    case 'SET_SELECTION': {
      const next = new Map(state.selection);
      const ids = action.ids instanceof Set ? action.ids : new Set(action.ids);
      if (ids.size === 0) {
        next.delete(action.kind);
      } else {
        next.set(action.kind, ids as Set<string>);
      }
      return {...state, selection: next};
    }
    case 'SET_SELECTION_MULTI': {
      let changed = false;
      const next = new Map(state.selection);
      for (const [kind, ids] of Object.entries(action.selection) as [
        SelectableKind,
        ReadonlySet<string>,
      ][]) {
        const current = next.get(kind);
        if (sameIdSet(current, ids)) continue;
        changed = true;
        if (ids.size === 0) next.delete(kind);
        else next.set(kind, new Set(ids));
      }
      return changed ? {...state, selection: next} : state;
    }
    case 'CLEAR_SELECTION':
      if (state.selection.size === 0) return state;
      return {...state, selection: new Map()};
    case 'SET_HOVER': {
      const next = action.hovered;
      const cur = state.hovered;
      // Reference equality fast-path: skip dispatch when nothing changed.
      if (
        cur === next ||
        (cur && next && cur.kind === next.kind && cur.id === next.id)
      ) {
        return state;
      }
      return {...state, hovered: next};
    }
    case 'SET_CHART_ORIGIN':
      return {...state, chartOrigin: action.origin};
    case 'SET_ACTIVE_TOOL':
      return {...state, activeTool: action.tool};
    case 'SET_GRID_DIVISION':
      return {...state, gridDivision: action.division};

    case 'EXECUTE_COMMAND': {
      // Save current chartDoc for undo
      const prevDoc = state.chartDoc;
      if (!prevDoc) return state;

      // Push the pre-command state as one entry, capped at the limit.
      const undoEntries = [
        ...state.undoEntries,
        {
          command: action.command,
          doc: prevDoc,
          visible: state.visibleTrackKeys,
        },
      ].slice(-UNDO_STACK_CAP);

      // Content-derived stamps (plan 0074 Design C): recompute only what
      // this command declares it touched — the affected tracks, and the
      // tempo stamp when the command's entityKinds include tempo/timesig.
      // Everything else carries over so undo/redo can restore a prior
      // stamp value by full-recomputing from the restored doc instead of
      // trying to reverse an increment.
      //
      // A tempo/time-signature edit is the exception to "only the declared
      // tracks": every tempo command deliberately declares no
      // `affectedTracks` (its intent is the grid, not one instrument), yet
      // KEEP-MS re-ticks every note in the doc — and track stamps hash note
      // ticks. Carrying the pre-edit stamps forward there would leave them
      // disagreeing with the doc until the next UNDO/REDO full recompute,
      // which would then flip every track to "stale" with no user edit in
      // between. So a tempo-touching command forces a full recompute.
      const tempoTouched =
        action.command.entityKinds.has('tempo') ||
        action.command.entityKinds.has('timesig');

      return {
        ...state,
        ...applyDocToState(state, action.chartDoc),
        dirty: true,
        undoEntries,
        // Clear redo stack on new edit (new branch)
        redoEntries: [],
        trackStamps: tempoTouched
          ? computeAllTrackStamps(action.chartDoc)
          : recomputeTrackStamps(
              action.chartDoc,
              state.trackStamps,
              action.command.affectedTracks,
            ),
        tempoStamp: tempoTouched
          ? computeTempoStamp(action.chartDoc)
          : state.tempoStamp,
      };
    }

    case 'SET_ASSIST_PROVENANCE': {
      if (!state.chartDoc) return state;
      // Deliberately leaves every stack and stamp alone: provenance is
      // metadata about the doc's artifacts, and an ack changes no chart
      // content, so neither the undo history nor any content stamp moves.
      return {
        ...state,
        chartDoc: withAssistProvenance(state.chartDoc, action.provenance),
        dirty: true,
      };
    }

    case 'SET_CHART_METADATA': {
      if (!state.chartDoc) return state;
      // `song.ini` fields are not chart content: no track, tempo map or
      // section moved, so every stamp and both history stacks stand.
      return {...state, chartDoc: action.chartDoc, dirty: true};
    }

    case 'UNDO': {
      const undone = state.undoEntries[state.undoEntries.length - 1];
      if (!undone || !state.chartDoc) return state;

      // Check if we've returned to the saved state
      const newUndoDepth = state.undoEntries.length - 1;
      const isDirty = newUndoDepth !== state.savedUndoDepth;

      return {
        ...state,
        ...applyDocToState(state, action.chartDoc, undone.visible),
        dirty: isDirty,
        undoEntries: state.undoEntries.slice(0, -1),
        redoEntries: [
          ...state.redoEntries,
          {
            command: undone.command,
            doc: state.chartDoc,
            visible: state.visibleTrackKeys,
          },
        ],
        // Full recompute from the restored doc (plan 0074 Design C) — this
        // is what makes staleness disappear when undo lands back on the
        // exact content an assist task generated from, and makes a
        // generated track's stamp disappear together with the track when
        // undo removes both.
        trackStamps: computeAllTrackStamps(action.chartDoc),
        tempoStamp: computeTempoStamp(action.chartDoc),
      };
    }

    case 'REDO': {
      const redone = state.redoEntries[state.redoEntries.length - 1];
      if (!redone || !state.chartDoc) return state;

      const newUndoDepth = state.undoEntries.length + 1;
      const isDirty = newUndoDepth !== state.savedUndoDepth;

      return {
        ...state,
        ...applyDocToState(state, action.chartDoc, redone.visible),
        dirty: isDirty,
        undoEntries: [
          ...state.undoEntries,
          {
            command: redone.command,
            doc: state.chartDoc,
            visible: state.visibleTrackKeys,
          },
        ],
        redoEntries: state.redoEntries.slice(0, -1),
        // Full recompute, same reasoning as UNDO above.
        trackStamps: computeAllTrackStamps(action.chartDoc),
        tempoStamp: computeTempoStamp(action.chartDoc),
      };
    }

    case 'MARK_SAVED':
      return {
        ...state,
        dirty: false,
        savedUndoDepth: state.undoEntries.length,
      };

    case 'SET_CLIPBOARD':
      return {...state, clipboard: action.clipboard};

    case 'SET_TRACK_VISIBILITY': {
      const visible = new Set(state.visibleTrackKeys);
      const id = trackKeyId(action.track);
      if (action.visible) {
        // Reconciled like every other write to the set, so "visibleTrackKeys
        // only ever names tracks the doc contains" holds here too and no
        // consumer has to re-filter.
        const inDoc =
          state.chartDoc === null ||
          state.chartDoc.parsedChart.trackData.some(
            track => trackKeyId(track) === id,
          );
        if (!inDoc) return state;
        visible.add(id);
        // Showing a track is an interaction with it, so it becomes the
        // last-interacted track. That keeps keyboard note entry, the Note
        // Inspector, and the non-stacked piano roll (all resolved from
        // `activeScope`) pointed at the track the user just revealed
        // instead of at whichever one they last touched.
        return {
          ...state,
          visibleTrackKeys: visible,
          activeScope: {kind: 'track', track: action.track},
        };
      }
      visible.delete(id);
      // Hiding the last-interacted track would otherwise leave keyboard
      // note entry and the Note Inspector (both resolved from
      // `activeScope`) pointed at a track no pane renders anymore. Fall
      // back to the next remaining visible track, in the Set's insertion
      // order — the same order the highway panes render in.
      let activeScope = state.activeScope;
      if (
        activeScope.kind === 'track' &&
        trackKeyId(activeScope.track) === id &&
        visible.size > 0
      ) {
        const fallbackId = visible.values().next().value;
        const fallbackTrack = fallbackId ? parseTrackKeyId(fallbackId) : null;
        if (fallbackTrack) {
          activeScope = {kind: 'track', track: fallbackTrack};
        }
      }
      return {...state, visibleTrackKeys: visible, activeScope};
    }

    case 'SET_VISIBLE_TRACKS':
      // Reconciled here too, so "visibleTrackKeys only ever names tracks the
      // doc contains" holds for every write and no consumer has to re-filter.
      return {
        ...state,
        visibleTrackKeys: state.chartDoc
          ? reconcileVisibleTracks(state.chartDoc, action.tracks)
          : action.tracks,
      };

    case 'SET_CURSOR_TICK':
      if (state.cursorTick === action.tick) return state;
      return {...state, cursorTick: Math.max(0, action.tick)};

    case 'SET_LOOP_REGION':
      return {...state, loopRegion: action.region};

    case 'SET_HIGHWAY_MODE':
      if (state.highwayMode === action.mode) return state;
      return {...state, highwayMode: action.mode};

    case 'SET_SHOW_SHEET_MUSIC':
      if (state.showSheetMusic === action.show) return state;
      return {...state, showSheetMusic: action.show};

    case 'SET_TEMPO_GLUE_MODE':
      if (state.tempoGlueMode === action.mode) return state;
      return {...state, tempoGlueMode: action.mode};

    case 'SET_PENDING_TEMPO_CANDIDATE':
      if (state.pendingTempoCandidate === action.candidate) return state;
      return {...state, pendingTempoCandidate: action.candidate};

    case 'SET_ACTIVE_SCOPE':
      if (state.activeScope === action.scope) return state;
      // Clear selection when a row becomes active. Track-qualified note ids
      // prevent cross-row collisions, but a scope switch still should not
      // silently carry a selection into a different editing surface.
      return {
        ...state,
        activeScope: action.scope,
        selection: new Map(),
        hovered: null,
      };

    default:
      return state;
  }
}
