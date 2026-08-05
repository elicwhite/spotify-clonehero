/**
 * EditorTool — the registered-tool contract for highway pointer gestures.
 * Each tool owns one gesture family; `useHighwayMouseInteraction` builds a
 * `ToolContext` once per pointer event and hands it to whichever tool(s) the
 * active `ToolMode` resolves to via `../tools/registry`.
 *
 * The hook owns all local React state (hover, drag anchors) because that
 * state has to survive across renders and pointer events — tools read/write
 * it through the `drag` accessor bundle on `ToolContext` rather than owning
 * `useState` themselves, which keeps tools plain, dependency-free objects
 * that a stub context can drive in tests without React.
 *
 * `ToolContext` carries raw `state`/`dispatch`/`executeCommand` from
 * `ChartEditorContext` plus the screen→chart coordinate helpers every tool
 * needs.
 */

import type {EntityKind, InstrumentSchema, NoteEvent} from '@/lib/chart-edit';
import type {EditCommand} from '../commands';
import type {
  ChartEditorAction,
  ChartEditorState,
} from '@/lib/chart-editor-core';
import type {EditorCapabilities} from '../capabilities';
import type {HitResult} from '@/lib/preview/highway';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

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

/** Read/write accessors for the hook's local drag/hover state.
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
}

export interface ToolContext {
  state: ChartEditorState;
  capabilities: EditorCapabilities;
  /** The active scope's `InstrumentSchema` (`selectActiveSchema`), or null
   *  for non-track scopes (`vocals`/`global`). Tools resolve lane/type math
   *  through this instead of a hardcoded `drums4LaneSchema`. */
  schema: InstrumentSchema | null;
  /** Notes in the active track whose type is one of `schema`'s lanes
   *  (`listNotes(track, schema)`) — schema-generic, not drum-only. */
  activeNotes: NoteEvent[];
  timedTempos: TimedTempo[];
  resolution: number;
  dispatch: (action: ChartEditorAction) => void;
  executeCommand: (cmd: EditCommand) => void;
  screenToLane: (x: number, y: number) => number;
  screenToMs: (x: number, y: number) => number;
  screenToTick: (x: number, y: number) => number;
  drag: ToolDragAccessors;
}

/**
 * A registered highway tool. `onPointerDown` is required — a tool that only
 * fires on click implements just that. `onPointerMove`/`onPointerUp` are
 * optional continuations for tools that span a drag (select-move, box-select,
 * erase-paint).
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
