/**
 * EditorTool — the registered-tool contract that replaced the hardcoded
 * `switch (state.activeTool)` in `useHighwayMouseInteraction`. Each tool owns
 * one gesture family; the hook builds a `ToolContext` once per pointer event
 * and hands it to whichever tool(s) the active `ToolMode` resolves to via
 * `../tools/registry`.
 *
 * The hook still owns all local React state (hover, drag anchors, the
 * double-click timer) because that state has to survive across renders and
 * pointer events — tools read/write it through the `drag` accessor bundle on
 * `ToolContext` rather than owning `useState` themselves, which keeps tools
 * plain, dependency-free objects that a stub `EditorSession`-backed context
 * can drive in tests without React.
 *
 * This is a pragmatic instantiation of the plan's `ToolContext` sketch
 * (`session` + `rendererRef` + `schema` + `selection`): the hook this
 * replaces never held an `EditorSession` instance, only raw
 * `state`/`dispatch`/`executeCommand` from `ChartEditorContext`, so
 * `ToolContext` carries those directly plus the coordinate/marker-drag
 * helpers every branch needed. A `session`-based context is the natural next
 * step once `ChartEditorContext` itself is backed by `EditorSession`.
 */

import type {DrumNote, EntityKind} from '@/lib/chart-edit';
import type {EditCommand} from '../commands';
import type {
  ChartEditorAction,
  ChartEditorState,
} from '@/lib/chart-editor-core';
import type {EditorCapabilities} from '../capabilities';
import type {HitResult} from '@/lib/preview/highway';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import type {HighwayPopoverState} from '../highway/HighwayPopovers';
import type {MarkerDragState, MarkerKind} from '../highway/useMarkerDrag';

/** Live state of a multi-note drag (mirrors `NoteDragState` in the hook). */
export interface NoteDragState {
  anchorTick: number;
  anchorLane: number;
  tickDelta: number;
  laneDelta: number;
  active: boolean;
}

export type EntityRef = {kind: EntityKind; id: string; tick: number};

/** Pointer-down/move/up payload every tool receives, already resolved from
 *  raw screen coordinates into hit/lane/tick/entity terms. */
export interface PointerHitInfo {
  coords: {x: number; y: number};
  shiftKey: boolean;
  hit: HitResult;
  lane: number;
  tick: number;
  entity: EntityRef | null;
}

/** Read/write accessors for the hook's local drag/hover/double-click state.
 *  Tools mutate the interaction through these instead of owning `useState`
 *  themselves, so the same tool object works against a stub in tests. */
export interface ToolDragAccessors {
  isDragging: boolean;
  setIsDragging: (value: boolean) => void;
  noteDrag: NoteDragState | null;
  setNoteDrag: (value: NoteDragState | null) => void;
  isErasing: boolean;
  setIsErasing: (value: boolean) => void;
  dragStart: {x: number; y: number} | null;
  setDragStart: (value: {x: number; y: number} | null) => void;
  dragCurrent: {x: number; y: number} | null;
  setDragCurrent: (value: {x: number; y: number} | null) => void;
  setHoverTick: (value: number | null) => void;
  lastClick: {tick: number; time: number} | null;
  setLastClick: (value: {tick: number; time: number} | null) => void;
}

export interface ToolContext {
  state: ChartEditorState;
  capabilities: EditorCapabilities;
  activePartName: string;
  activeNotes: DrumNote[];
  timedTempos: TimedTempo[];
  resolution: number;
  dispatch: (action: ChartEditorAction) => void;
  executeCommand: (cmd: EditCommand) => void;
  onOpenPopover: (popover: HighwayPopoverState) => void;
  screenToLane: (x: number, y: number) => number;
  screenToMs: (x: number, y: number) => number;
  screenToTick: (x: number, y: number) => number;
  markerDrag: MarkerDragState | null;
  beginMarkerDrag: (kind: MarkerKind, originalTick: number) => void;
  updateMarkerDrag: (rawTick: number) => void;
  commitMarkerDrag: (moveExceededThreshold: boolean) => void;
  drag: ToolDragAccessors;
}

/**
 * A registered highway tool. `onPointerDown` is required — a tool that only
 * fires on click (BPM/timesig/section popovers) implements just that.
 * `onPointerMove`/`onPointerUp` are optional continuations for tools that
 * span a drag (select-move, box-select, erase-paint, marker drag).
 */
export interface EditorTool {
  id: string;
  /** Cursor CSS value for the given hover hit, or undefined to defer to the
   *  caller's default. Optional — most tools don't need a bespoke cursor. */
  cursor?(hit: HitResult): string | undefined;
  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void;
  onPointerMove?(ctx: ToolContext, evt: PointerHitInfo): void;
  onPointerUp?(ctx: ToolContext, evt: PointerHitInfo): void;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
}
