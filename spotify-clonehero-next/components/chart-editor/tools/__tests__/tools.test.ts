/**
 * Pointer-flow tests for each registered `EditorTool`, driven against a
 * real `EditorSession` (the headless store the tools would run against in
 * production) rather than React state — mirrors `useExecuteCommand`'s
 * dispatch pattern (`lib/chart-editor-core/EditorSession.ts`,
 * `hooks/useEditCommands.ts`) so `executeCommand` behaves identically to
 * the hook.
 */

import {noteTypes} from '@eliwhite/scan-chart';
import {EditorSession} from '@/lib/chart-editor-core';
import {DRUM_EDIT_CAPABILITIES} from '../../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../../scope';
import {noteId, type EditCommand} from '../../commands';
import {makeFixtureDoc} from '../../__tests__/fixtures';
import {
  boxSelectTool,
  eraseTool,
  lyricsTimingTool,
  placeNoteTool,
  sectionTool,
  selectMoveTool,
  tempoMarkerTool,
  timeSignatureMarkerTool,
} from '../tools';
import {resolveCursorContinuation, resolveToolForPointerDown} from '../registry';
import type {NoteDragState, PointerHitInfo, ToolContext} from '../types';
import type {HighwayPopoverState} from '../../highway/HighwayPopovers';
import type {MarkerDragState, MarkerKind} from '../../highway/useMarkerDrag';

const RESOLUTION = 480;

/** Fixture note ids (see `makeFixtureDoc`'s tick layout doc comment). */
const KICK_ID = noteId({tick: 0, type: noteTypes.kick});
const RED_ID = noteId({tick: 480, type: noteTypes.redDrum});
const YELLOW_ID = noteId({tick: 960, type: noteTypes.yellowDrum});

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
): ToolContext & {
  drag: ToolContext['drag'];
  popovers: HighwayPopoverState[];
} {
  const popovers: HighwayPopoverState[] = [];
  let markerDrag: MarkerDragState | null = overrides.markerDrag ?? null;
  let lastClick: {tick: number; time: number} | null = null;

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
    get lastClick() {
      return lastClick;
    },
    setLastClick: value => {
      lastClick = value;
    },
  };

  const ctx: ToolContext & {
    drag: ToolContext['drag'];
    popovers: HighwayPopoverState[];
  } = {
    get state() {
      return session.getState();
    },
    capabilities: DRUM_EDIT_CAPABILITIES,
    activePartName: 'vocals',
    activeNotes: [],
    timedTempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
    resolution: RESOLUTION,
    dispatch: session.dispatch,
    executeCommand: (cmd: EditCommand) => {
      const doc = session.getState().chartDoc;
      if (!doc) return;
      const newDoc = cmd.execute(doc);
      session.dispatch({type: 'EXECUTE_COMMAND', command: cmd, chartDoc: newDoc});
    },
    onOpenPopover: (popover: HighwayPopoverState) => {
      popovers.push(popover);
    },
    screenToLane: (x: number) => x,
    screenToMs: (x: number) => x,
    screenToTick: (x: number) => x,
    get markerDrag() {
      return markerDrag;
    },
    beginMarkerDrag: (kind: MarkerKind, originalTick: number) => {
      markerDrag = {kind, originalTick, currentTick: originalTick};
    },
    updateMarkerDrag: (rawTick: number) => {
      if (markerDrag) markerDrag = {...markerDrag, currentTick: rawTick};
    },
    commitMarkerDrag: () => {
      markerDrag = null;
    },
    drag,
    popovers,
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
    expect(ctx.state.selection.get('note')).toEqual(new Set([RED_ID]));
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
      new Set([RED_ID, YELLOW_ID]),
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
      ids: new Set([RED_ID]),
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
        lastClick: null,
        setLastClick: () => {},
      },
    });

    selectMoveTool.onPointerUp?.(ctx, evt());

    const movedNote = ctx.state.chartDoc?.parsedChart.trackData[0].noteEventGroups
      .flat()
      .find(n => n.type === noteTypes.redDrum);
    expect(movedNote?.tick).toBe(720);
  });

  it('opens the section-rename popover on a fast double-click', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    const sectionEntity = {kind: 'section' as const, id: '0', tick: 0};
    const hit = {type: 'section' as const, tick: 0, name: 'Intro'};
    selectMoveTool.onPointerDown(ctx, evt({entity: sectionEntity, hit}));
    selectMoveTool.onPointerDown(ctx, evt({entity: sectionEntity, hit}));
    expect(ctx.popovers).toHaveLength(1);
    expect(ctx.popovers[0]).toMatchObject({
      kind: 'section-rename',
      currentSectionName: 'Intro',
    });
  });
});

describe('boxSelectTool', () => {
  it('clears note selection on a plain empty-highway click', () => {
    const session = makeSession();
    session.dispatch({
      type: 'SET_SELECTION',
      kind: 'note',
      ids: new Set([RED_ID]),
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
        lastClick: null,
        setLastClick: () => {},
      },
    });
    // screenToLane/screenToMs are pass-through identity stubs here, so a
    // rectangle from (0,0) to (100,100) covers ms 0..100 and lanes 0..100
    // — wide enough to catch the kick note at tick 0 / ms 0.
    boxSelectTool.onPointerUp?.(ctx, evt({coords: {x: 100, y: 100}}));
    expect(ctx.state.selection.get('note')?.has(KICK_ID)).toBe(true);
  });
});

describe('placeNoteTool', () => {
  it('adds a note at the prospective lane/tick', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    placeNoteTool.onPointerDown(ctx, evt({lane: 1, tick: 240}));
    const notes = ctx.state.chartDoc!.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => n.tick);
    expect(notes).toContain(240);
  });

  it('removes an existing note on toggle-click', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    placeNoteTool.onPointerDown(
      ctx,
      evt({hit: {type: 'note', noteId: RED_ID, note: {} as never, lane: 1, tick: 480}}),
    );
    const notes = ctx.state.chartDoc!.parsedChart.trackData[0].noteEventGroups
      .flat()
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
        lastClick: null,
        setLastClick: () => {},
      },
    });
    eraseTool.onPointerDown(
      ctx,
      evt({entity: {kind: 'note', id: RED_ID, tick: 480}}),
    );
    const notes = ctx.state.chartDoc!.parsedChart.trackData[0].noteEventGroups
      .flat()
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
        lastClick: null,
        setLastClick: () => {},
      },
    });
    eraseTool.onPointerMove?.(
      ctx,
      evt({hit: {type: 'note', noteId: YELLOW_ID, note: {} as never, lane: 2, tick: 960}}),
    );
    const notes = ctx.state.chartDoc!.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => n.tick);
    expect(notes).not.toContain(960);
  });

  it('does not paint-erase when isErasing is false', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    eraseTool.onPointerMove?.(
      ctx,
      evt({hit: {type: 'note', noteId: YELLOW_ID, note: {} as never, lane: 2, tick: 960}}),
    );
    const notes = ctx.state.chartDoc!.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => n.tick);
    expect(notes).toContain(960);
  });
});

describe('tempoMarkerTool', () => {
  it('opens the bpm popover pre-filled with the tempo in effect at the tick', () => {
    const session = makeSession();
    const ctx = makeContext(session, {
      timedTempos: [
        {tick: 0, beatsPerMinute: 120, msTime: 0},
        {tick: 1920, beatsPerMinute: 140, msTime: 8000},
      ],
    });
    tempoMarkerTool.onPointerDown(ctx, evt({tick: 2000, coords: {x: 5, y: 6}}));
    expect(ctx.popovers).toEqual([
      {kind: 'bpm', tick: 2000, x: 5, y: 6, initialBpm: 140},
    ]);
  });
});

describe('timeSignatureMarkerTool', () => {
  it('opens the timesig popover at the clicked tick', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    timeSignatureMarkerTool.onPointerDown(
      ctx,
      evt({tick: 960, coords: {x: 1, y: 2}}),
    );
    expect(ctx.popovers).toEqual([{kind: 'timesig', tick: 960, x: 1, y: 2}]);
  });
});

describe('sectionTool', () => {
  it('opens the add-section popover at the clicked tick', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    sectionTool.onPointerDown(ctx, evt({tick: 240, coords: {x: 3, y: 4}}));
    expect(ctx.popovers).toEqual([{kind: 'section', tick: 240, x: 3, y: 4}]);
  });
});

describe('lyricsTimingTool', () => {
  it('selects a lyric entity and starts a marker drag', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    lyricsTimingTool.onPointerDown(
      ctx,
      evt({entity: {kind: 'lyric', id: 'lyric-1', tick: 240}}),
    );
    expect(ctx.state.selection.get('lyric')).toEqual(new Set(['lyric-1']));
    expect(ctx.markerDrag).toEqual({
      kind: 'lyric',
      originalTick: 240,
      currentTick: 240,
    });
  });

  it('ignores note entities', () => {
    const session = makeSession();
    const ctx = makeContext(session);
    lyricsTimingTool.onPointerDown(
      ctx,
      evt({entity: {kind: 'note', id: RED_ID, tick: 480}}),
    );
    expect(ctx.state.selection.get('note')?.size ?? 0).toBe(0);
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
    const tool = resolveToolForPointerDown('cursor', evt(), DRUM_EDIT_CAPABILITIES);
    expect(tool).toBe(boxSelectTool);
  });

  it('resolveToolForPointerDown maps non-cursor modes to their single tool', () => {
    expect(resolveToolForPointerDown('place', evt(), DRUM_EDIT_CAPABILITIES)).toBe(
      placeNoteTool,
    );
    expect(resolveToolForPointerDown('erase', evt(), DRUM_EDIT_CAPABILITIES)).toBe(
      eraseTool,
    );
    expect(resolveToolForPointerDown('bpm', evt(), DRUM_EDIT_CAPABILITIES)).toBe(
      tempoMarkerTool,
    );
    expect(
      resolveToolForPointerDown('timesig', evt(), DRUM_EDIT_CAPABILITIES),
    ).toBe(timeSignatureMarkerTool);
    expect(
      resolveToolForPointerDown('section', evt(), DRUM_EDIT_CAPABILITIES),
    ).toBe(sectionTool);
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
        lastClick: null,
        setLastClick: () => {},
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
