/**
 * Maps `ToolMode` (the sidebar's Tools palette selection) to the
 * `EditorTool`(s) that handle it, replacing the hardcoded
 * `switch (state.activeTool)` in `useHighwayMouseInteraction`.
 *
 * `'cursor'` is the one mode with more than one tool: `selectMoveTool` and
 * `boxSelectTool` split the old single `case 'cursor':` branch, chosen at
 * pointer-down by whether a selectable entity is under the cursor, and at
 * pointer-move/up by whether a note or marker drag is in flight (a gesture
 * started by `selectMoveTool` must finish there even if the cursor drifts
 * off every entity mid-drag).
 *
 * `EditorCapabilities.showToolPalette`/`showNotePlacementTools` (and future
 * per-page tool allowlists) decide which `ToolMode`s a page's sidebar
 * offers; this registry only decides which tool object a given mode maps
 * to once a pointer event arrives.
 */

import type {ToolMode} from '@/lib/chart-editor-core';
import {AFFORDANCES} from '../affordances';
import type {EditorCapabilities} from '../capabilities';
import {
  selectMoveTool,
  boxSelectTool,
  placeNoteTool,
  eraseTool,
  tempoMarkerTool,
  timeSignatureMarkerTool,
  sectionTool,
} from './tools';
import type {EditorTool, PointerHitInfo, ToolContext} from './types';

/** Every tool registered for each `ToolMode`. `'cursor'` is the only mode
 *  with more than one entry. */
export const TOOL_REGISTRY: Record<ToolMode, readonly EditorTool[]> = {
  cursor: [selectMoveTool, boxSelectTool],
  place: [placeNoteTool],
  erase: [eraseTool],
  bpm: [tempoMarkerTool],
  timesig: [timeSignatureMarkerTool],
  section: [sectionTool],
};

/** Which tool a pointer-down in the given `ToolMode` should dispatch to. */
export function resolveToolForPointerDown(
  toolMode: ToolMode,
  evt: PointerHitInfo,
  capabilities: EditorCapabilities,
): EditorTool | null {
  const tools = TOOL_REGISTRY[toolMode];
  if (!tools || tools.length === 0) return null;
  if (tools.length === 1) return tools[0];

  const {entity} = evt;
  if (
    entity &&
    AFFORDANCES[entity.kind].selectable &&
    capabilities.selectable.has(entity.kind)
  ) {
    return selectMoveTool;
  }
  return boxSelectTool;
}

/**
 * Which tool a pointer-move/up in `'cursor'` mode continues on. Unlike
 * pointer-down (decided by what's under the cursor), a continuation is
 * decided by what gesture is already in flight: a note or marker drag
 * started by `selectMoveTool` must keep routing there even once the pointer
 * has drifted off every entity; otherwise it's `boxSelectTool`'s marquee.
 */
export function resolveCursorContinuation(ctx: ToolContext): EditorTool {
  if (ctx.drag.isDragging || ctx.markerDrag) return selectMoveTool;
  return boxSelectTool;
}
