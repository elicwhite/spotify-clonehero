/**
 * Pointer-flow tests for each registered `EditorTool`, driven against a
 * real `EditorSession` (the headless store the tools would run against in
 * production) rather than React state — mirrors `useExecuteCommand`'s
 * dispatch pattern (`lib/chart-editor-core/EditorSession.ts`,
 * `hooks/useEditCommands.ts`) so `executeCommand` behaves identically to
 * the hook.
 */

import {noteTypes} from '@eliwhite/scan-chart';
import {drums4LaneSchema} from '@/lib/chart-edit';
import {EditorSession} from '@/lib/chart-editor-core';
import {DRUM_EDIT_CAPABILITIES} from '../../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../../scope';
import {noteId, type EditCommand} from '../../commands';
import {makeFixtureDoc} from '../../__tests__/fixtures';
import {
  boxSelectTool,
  eraseTool,
  placeNoteTool,
  selectMoveTool,
} from '../tools';
import {
  TOOL_REGISTRY,
  resolveCursorContinuation,
  resolveToolForPointerDown,
} from '../registry';
import type {NoteDragState, PointerHitInfo, ToolContext} from '../types';

const RESOLUTION = 480;

/** Fixture note ids (see `makeFixtureDoc`'s tick layout doc comment). */
const KICK_ID = noteId({tick: 0, type: noteTypes.kick});
const RED_ID = noteId({tick: 480, type: noteTypes.redDrum});
const YELLOW_ID = noteId({tick: 960, type: noteTypes.yellowDrum});

/** Selection ids are stored track-qualified, so the same local id in another
 *  track can never be mistaken for this one. */
const qualified = (id: string) => `drums:expert|${id}`;

function makeSession() {
  return new EditorSession(
    {chartDoc: makeFixtureDoc(), activeScope: DEFAULT_DRUMS_EXPERT_SCOPE},
    DRUM_EDIT_CAPABILITIES,
  );
}

/**
 * Builds a `ToolContext` backed by a live `EditorSession`, plus a mutable
 * `drag` bundle a test can inspect after a pointer call. `screenToLane` /
 * `screenToMs` / `screenToTick` are stubbed as pass-throughs — the tools
 * never call the underlying `InteractionManager`, only these functions —
 * so tests drive them with tick/lane values directly instead of pixels.
 */
function makeContext(
  session: EditorSession,
  overrides: Partial<ToolContext> = {},
): ToolContext & {drag: ToolContext['drag']} {
  const drag: ToolContext['drag'] = {
    isDragging: false,
    setIsDragging: () => {},
    noteDrag: null,
    setNoteDrag: () => {},
    isErasing: false,
    setIsErasing: () => {},
    dragStart: null,
    setDragStart: () => {},
    dragCurrent: null,
    setDragCurrent: () => {},
    setHoverTick: () => {},
  };

  const ctx: ToolContext & {drag: ToolContext['drag']} = {
    get state() {
      return session.getState();
    },
    capabilities: DRUM_EDIT_CAPABILITIES,
    schema: drums4LaneSchema,
    activeNotes: [],
    timedTempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
    resolution: RESOLUTION,
    dispatch: session.dispatch,
    executeCommand: (cmd: EditCommand) => {
      const doc = session.getState().chartDoc;
      if (!doc) return;
      const newDoc = cmd.execute(doc);
      session.dispatch({
        type: 'EXECUTE_COMMAND',
        command: cmd,
        chartDoc: newDoc,
      });
    },
    screenToLane: (x: number) => x,
    screenToMs: (x: number) => x,
    screenToTick: (x: number) => x,
    drag,
    ...overrides,
  };
  return ctx;
}

function evt(overrides: Partial<PointerHitInfo> = {}): PointerHitInfo {
  return {
    coords: {x: 0, y: 0},
    shiftKey: false,
    hit: null,
    lane: 0,
    tick: 0,
    entity: null,
    ...overrides,
  };
}

describe('selectMoveTool', () => {
  it('selects a note on pointer down', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    selectMoveTool.onPointerDown(
      ctx,
      evt({entity: {kind: 'note', id: RED_ID, tick: 480}}),
    );
    expect(ctx.state.selection.get('note')).toEqual(
      new Set([qualified(RED_ID)]),
    );
  });

  it('shift-click toggles a second note into the selection', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    selectMoveTool.onPointerDown(
      ctx,
      evt({entity: {kind: 'note', id: RED_ID, tick: 480}}),
    );
    selectMoveTool.onPointerDown(
      ctx,
      evt({
        shiftKey: true,
        entity: {kind: 'note', id: YELLOW_ID, tick: 960},
      }),
    );
    expect(ctx.state.selection.get('note')).toEqual(
      new Set([qualified(RED_ID), qualified(YELLOW_ID)]),
    );
  });

  it('shift-click again deselects the same note', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    selectMoveTool.onPointerDown(
      ctx,
      evt({entity: {kind: 'note', id: RED_ID, tick: 480}}),
    );
    selectMoveTool.onPointerDown(
      ctx,
      evt({shiftKey: true, entity: {kind: 'note', id: RED_ID, tick: 480}}),
    );
    expect(ctx.state.selection.get('note')?.size ?? 0).toBe(0);
  });

  it('commits a note move on pointer up using the anchored delta', () => {
    const session = makeSession();
    session.dispatch({
      type: 'SET_SELECTION',
      kind: 'note',
      ids: new Set([qualified(RED_ID)]),
    });
    const noteDrag: NoteDragState = {
      anchorTick: 480,
      anchorLane: 1,
      tickDelta: 240,
      laneDelta: 0,
      active: true,
    };
    const ctx = makeContext(session, {
      drag: {
        isDragging: true,
        setIsDragging: () => {},
        noteDrag,
        setNoteDrag: () => {},
        isErasing: false,
        setIsErasing: () => {},
        dragStart: {x: 0, y: 0},
        setDragStart: () => {},
        dragCurrent: {x: 0, y: 0},
        setDragCurrent: () => {},
        setHoverTick: () => {},
      },
    });

    selectMoveTool.onPointerUp?.(ctx, evt());

    const movedNote =
      ctx.state.chartDoc?.parsedChart.trackData[0].noteEventGroups
        .flat()
        .find(n => n.type === noteTypes.redDrum);
    expect(movedNote?.tick).toBe(720);
  });

  it('leaves selection untouched for a non-note entity', () => {
    const session = makeSession();
    session.dispatch({
      type: 'SET_SELECTION',
      kind: 'note',
      ids: new Set([qualified(RED_ID)]),
    });
    const ctx = makeContext(session);
    selectMoveTool.onPointerDown(
      ctx,
      evt({entity: {kind: 'section', id: '480', tick: 480}}),
    );
    expect(ctx.state.selection.get('note')).toEqual(
      new Set([qualified(RED_ID)]),
    );
    expect(ctx.state.selection.get('section')?.size ?? 0).toBe(0);
  });
});

describe('boxSelectTool', () => {
  it('clears note selection on a plain empty-highway click', () => {
    const session = makeSession();
    session.dispatch({
      type: 'SET_SELECTION',
      kind: 'note',
      ids: new Set([qualified(RED_ID)]),
    });
    const ctx = makeContext(session);
    boxSelectTool.onPointerDown(ctx, evt());
    expect(ctx.state.selection.get('note')?.size ?? 0).toBe(0);
  });

  it('marquee-selects notes inside the dragged rectangle', () => {
    const session = makeSession();
    const activeNotes = session
      .getState()
      .chartDoc!.parsedChart.trackData[0].noteEventGroups.flat();
    const ctx = makeContext(session, {
      activeNotes: activeNotes as unknown as ToolContext['activeNotes'],
      drag: {
        isDragging: false,
        setIsDragging: () => {},
        noteDrag: null,
        setNoteDrag: () => {},
        isErasing: false,
        setIsErasing: () => {},
        dragStart: {x: 0, y: 0},
        setDragStart: () => {},
        dragCurrent: {x: 100, y: 100},
        setDragCurrent: () => {},
        setHoverTick: () => {},
      },
    });
    // screenToLane/screenToMs are pass-through identity stubs here, so a
    // rectangle from (0,0) to (100,100) covers ms 0..100 and lanes 0..100
    // — wide enough to catch the kick note at tick 0 / ms 0.
    boxSelectTool.onPointerUp?.(ctx, evt({coords: {x: 100, y: 100}}));
    expect(ctx.state.selection.get('note')?.has(qualified(KICK_ID))).toBe(true);
  });
});

describe('placeNoteTool', () => {
  it('adds a note at the prospective lane/tick', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    placeNoteTool.onPointerDown(ctx, evt({lane: 1, tick: 240}));
    const notes = ctx.state
      .chartDoc!.parsedChart.trackData[0].noteEventGroups.flat()
      .map(n => n.tick);
    expect(notes).toContain(240);
  });

  it('removes an existing note on toggle-click', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    placeNoteTool.onPointerDown(
      ctx,
      evt({
        hit: {
          type: 'note',
          noteId: RED_ID,
          note: {} as never,
          lane: 1,
          tick: 480,
        },
      }),
    );
    const notes = ctx.state
      .chartDoc!.parsedChart.trackData[0].noteEventGroups.flat()
      .map(n => n.tick);
    expect(notes).not.toContain(480);
  });
});

describe('eraseTool', () => {
  it('deletes the hit note on pointer down and arms paint-erase', () => {
    const session = makeSession();
    const setIsErasing = jest.fn();
    const ctx = makeContext(session, {
      drag: {
        isDragging: false,
        setIsDragging: () => {},
        noteDrag: null,
        setNoteDrag: () => {},
        isErasing: false,
        setIsErasing,
        dragStart: null,
        setDragStart: () => {},
        dragCurrent: null,
        setDragCurrent: () => {},
        setHoverTick: () => {},
      },
    });
    eraseTool.onPointerDown(
      ctx,
      evt({entity: {kind: 'note', id: RED_ID, tick: 480}}),
    );
    const notes = ctx.state
      .chartDoc!.parsedChart.trackData[0].noteEventGroups.flat()
      .map(n => n.tick);
    expect(notes).not.toContain(480);
    expect(setIsErasing).toHaveBeenCalledWith(true);
  });

  it('paint-erases a hit note on pointer move while isErasing', () => {
    const session = makeSession();
    const ctx = makeContext(session, {
      drag: {
        isDragging: false,
        setIsDragging: () => {},
        noteDrag: null,
        setNoteDrag: () => {},
        isErasing: true,
        setIsErasing: () => {},
        dragStart: {x: 0, y: 0},
        setDragStart: () => {},
        dragCurrent: {x: 0, y: 0},
        setDragCurrent: () => {},
        setHoverTick: () => {},
      },
    });
    eraseTool.onPointerMove?.(
      ctx,
      evt({
        hit: {
          type: 'note',
          noteId: YELLOW_ID,
          note: {} as never,
          lane: 2,
          tick: 960,
        },
      }),
    );
    const notes = ctx.state
      .chartDoc!.parsedChart.trackData[0].noteEventGroups.flat()
      .map(n => n.tick);
    expect(notes).not.toContain(960);
  });

  it('does not paint-erase when isErasing is false', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    eraseTool.onPointerMove?.(
      ctx,
      evt({
        hit: {
          type: 'note',
          noteId: YELLOW_ID,
          note: {} as never,
          lane: 2,
          tick: 960,
        },
      }),
    );
    const notes = ctx.state
      .chartDoc!.parsedChart.trackData[0].noteEventGroups.flat()
      .map(n => n.tick);
    expect(notes).toContain(960);
  });
});

describe('registry', () => {
  it('resolveToolForPointerDown picks selectMoveTool for a selectable hit', () => {
    const tool = resolveToolForPointerDown(
      'cursor',
      evt({entity: {kind: 'note', id: RED_ID, tick: 480}}),
      DRUM_EDIT_CAPABILITIES,
    );
    expect(tool).toBe(selectMoveTool);
  });

  it('resolveToolForPointerDown picks boxSelectTool for an empty hit', () => {
    const tool = resolveToolForPointerDown(
      'cursor',
      evt(),
      DRUM_EDIT_CAPABILITIES,
    );
    expect(tool).toBe(boxSelectTool);
  });

  it('resolveToolForPointerDown maps non-cursor modes to their single tool', () => {
    expect(
      resolveToolForPointerDown('place', evt(), DRUM_EDIT_CAPABILITIES),
    ).toBe(placeNoteTool);
    expect(
      resolveToolForPointerDown('erase', evt(), DRUM_EDIT_CAPABILITIES),
    ).toBe(eraseTool);
  });

  it('registers a tool for every ToolMode and none for tempo editing', () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([
      'cursor',
      'erase',
      'place',
    ]);
  });

  it('resolveCursorContinuation follows an in-flight note drag to selectMoveTool', () => {
    const session = makeSession();
    const ctx = makeContext(session, {
      drag: {
        isDragging: true,
        setIsDragging: () => {},
        noteDrag: null,
        setNoteDrag: () => {},
        isErasing: false,
        setIsErasing: () => {},
        dragStart: null,
        setDragStart: () => {},
        dragCurrent: null,
        setDragCurrent: () => {},
        setHoverTick: () => {},
      },
    });
    expect(resolveCursorContinuation(ctx)).toBe(selectMoveTool);
  });

  it('resolveCursorContinuation defaults to boxSelectTool with no drag in flight', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    expect(resolveCursorContinuation(ctx)).toBe(boxSelectTool);
  });
});
