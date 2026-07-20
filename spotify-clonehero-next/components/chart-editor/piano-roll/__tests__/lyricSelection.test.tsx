/**
 * @jest-environment jsdom
 */
/**
 * Lyrics behave like notes for selection and dragging (Round 3): a lyric
 * chip participates in click/shift multi-select the same way a note does,
 * the marquee picks up lyrics when its rectangle reaches the lyrics row
 * (but never the tempo lane, which sits between the lyrics row and the note
 * lanes and has no selection concept at all), and dragging a mixed
 * note+lyric selection moves both by the same tick delta — each lyric
 * independently clamped to its own phrase, matching single-chip drag.
 *
 * Mounts the real PianoRollTimeline (same harness as contextMenu.test.tsx)
 * and drives the actual pointer event path.
 */

import '@testing-library/jest-dom';
import {act, render} from '@testing-library/react';
import {useEffect} from 'react';
import PianoRollTimeline from '../PianoRollTimeline';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
import {getSelectedIds, type ChartEditorState} from '@/lib/chart-editor-core';
import {retimeChart} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {makeFixtureDoc} from '../../__tests__/fixtures';
import type {AudioManager} from '@/lib/preview/audioManager';

beforeAll(() => {
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const ctxStub = new Proxy(
    {
      measureText: () => ({width: 10}),
      canvas: {width: 800, height: 200},
    },
    {
      get(target, prop) {
        if (prop in target) {
          return (target as Record<string | symbol, unknown>)[prop];
        }
        return () => {};
      },
      set() {
        return true;
      },
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    ctxStub) as unknown as HTMLCanvasElement['getContext'];
  HTMLElement.prototype.setPointerCapture = function () {};
  HTMLElement.prototype.releasePointerCapture = function () {};
  HTMLElement.prototype.hasPointerCapture = function () {
    return false;
  };
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 800,
      height: 200,
      top: 0,
      left: 0,
      right: 800,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  });
});

function stubAudioManager(): AudioManager {
  return {
    chartTime: 0,
    isPlaying: false,
    duration: 10,
    chartDelay: 0,
    ready: Promise.resolve(),
    trackNames: ['drums', 'song'],
    getTrackPcm: () => null,
    seekToChartTime: () => {},
    playChartTime: () => {},
  } as unknown as AudioManager;
}

function SeedDoc({make}: {make: () => ChartDocument}) {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    const doc = make();
    retimeChart(doc.parsedChart);
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
  }, [dispatch, make]);
  return null;
}

/** Stashes the latest context state into `outRef.current` on every render,
 *  so the test can read selection + the committed doc without reaching into
 *  private component internals. */
function StateCapture({outRef}: {outRef: {current: ChartEditorState | null}}) {
  const {state} = useChartEditorContext();
  useEffect(() => {
    outRef.current = state;
  });
  return null;
}

async function mountPanel(make: () => ChartDocument = makeFixtureDoc) {
  const stateRef: {current: ChartEditorState | null} = {current: null};
  const {container} = render(
    <ChartEditorProvider>
      <SeedDoc make={make} />
      <StateCapture outRef={stateRef} />
      <PianoRollTimeline
        audioManager={stubAudioManager()}
        durationSeconds={10}
        audioChannels={2}
      />
    </ChartEditorProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  const canvas = container.querySelector('canvas');
  if (!canvas) throw new Error('canvas not mounted');
  return {canvas, stateRef};
}

function fireAt(
  canvas: HTMLCanvasElement,
  type: string,
  {
    x,
    y,
    button = 0,
    shiftKey = false,
  }: {x: number; y: number; button?: number; shiftKey?: boolean},
) {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    shiftKey,
  });
  Object.defineProperty(evt, 'offsetX', {value: x, configurable: true});
  Object.defineProperty(evt, 'offsetY', {value: y, configurable: true});
  Object.defineProperty(evt, 'pointerId', {value: 1, configurable: true});
  canvas.dispatchEvent(evt);
}

/** A plain click: pointerdown + pointerup at the same spot, no movement —
 *  exercises select-on-click without crossing the drag threshold. */
function click(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  shiftKey = false,
) {
  fireAt(canvas, 'pointerdown', {x, y, shiftKey});
  fireAt(canvas, 'pointerup', {x, y, shiftKey});
}

// Fixture layout (makeFixtureDoc, 120 BPM, resolution 480). The panel's
// initial fit-to-width scale (px per ms) isn't a clean constant here — the
// beat grid pads `totalMs` past the raw 10s duration to a full bar — so
// note x positions below are picked with generous slack around their
// approximate fit-to-width position and verified against the fixture's
// known tick→ms mapping rather than an assumed px/ms constant.
// Rows (y, independent of the horizontal scale): ruler 0-24, lyrics 24-46,
// tempo 46-72, note lanes 72-160 (5 lanes @ 17.6px), waveform 160-200.
const RED_NOTE = {x: 40, y: 81};
const LYRIC_240 = {x: 20, y: 32};
const LYRIC_720 = {x: 60, y: 32};

/**
 * Locate the exact hit-testable x for a note by scanning a window around an
 * approximate guess and reading back the selection — robust to the beat
 * grid's internal end-tick padding (which this test has no need to know)
 * rather than hardcoding an assumed px/ms scale.
 *
 * Each probe click is its own `act()` — `StateCapture`'s effect (and thus
 * `stateRef.current`) only flushes when an `act()` call completes, so
 * batching every probe into one surrounding `act()` would read the same
 * stale state on every iteration.
 */
function findNoteX(
  canvas: HTMLCanvasElement,
  stateRef: {current: ChartEditorState | null},
  noteId: string,
  y: number,
  guess: number,
  radius = 40,
): number {
  for (let x = Math.max(0, guess - radius); x <= guess + radius; x++) {
    let hit = false;
    act(() => {
      click(canvas, x, y);
      hit = getSelectedIds(stateRef.current!, 'note').has(noteId);
      click(canvas, 999, 999);
    });
    if (hit) return x;
  }
  throw new Error(`findNoteX: no hit for ${noteId} near x=${guess}`);
}

function drumTicks(state: ChartEditorState | null): number[] {
  const track = state?.chartDoc?.parsedChart.trackData[0];
  if (!track) return [];
  return track.noteEventGroups
    .flat()
    .map(n => n.tick)
    .sort((a, b) => a - b);
}

function lyricTicks(state: ChartEditorState | null): number[] {
  const phrases =
    state?.chartDoc?.parsedChart.vocalTracks?.parts['vocals']?.notePhrases ??
    [];
  return phrases.flatMap(p => p.lyrics.map(l => l.tick)).sort((a, b) => a - b);
}

describe('lyrics multi-select', () => {
  it('click + shift-click on lyric chips mirrors note multi-select', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      click(canvas, LYRIC_240.x, LYRIC_240.y);
    });
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(1);

    act(() => {
      click(canvas, LYRIC_720.x, LYRIC_720.y, /* shiftKey */ true);
    });
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(2);

    // A plain (non-shift) click on an already-selected chip keeps the group
    // selected — same as `selectNote` — so it can be dragged together.
    act(() => {
      click(canvas, LYRIC_240.x, LYRIC_240.y);
    });
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(2);

    // Shift-click again toggles it off.
    act(() => {
      click(canvas, LYRIC_240.x, LYRIC_240.y, true);
    });
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(1);
  });

  it('note and lyric selections coexist independently (mixed selection)', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      click(canvas, RED_NOTE.x, RED_NOTE.y);
      click(canvas, LYRIC_240.x, LYRIC_240.y, true);
    });
    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(1);
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(1);
  });
});

describe('marquee (drag-select) spans notes and the lyrics row, never tempo', () => {
  it('selects notes AND lyrics when the rectangle reaches the lyrics row', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      // Start in empty note-lane space (x=170 is past the last note's hit
      // radius; y=150 is the kick lane), drag up past the tempo lane into
      // the lyrics row and left past every note/lyric.
      fireAt(canvas, 'pointerdown', {x: 170, y: 150});
      fireAt(canvas, 'pointermove', {x: -10, y: 28});
      fireAt(canvas, 'pointerup', {x: -10, y: 28});
    });

    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(5);
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(2);
    // Tempo has no selection concept at all — the doc's tempo list is
    // untouched by the marquee regardless.
    expect(stateRef.current!.chartDoc?.parsedChart.tempos.length).toBe(2);
  });

  it('does NOT select lyrics when the rectangle stays within the note lanes', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      // Same horizontal span as above, but the drag never leaves the note
      // lanes (72-160) — y1=75 is just below laneTop, still short of the
      // tempo lane / lyrics row.
      fireAt(canvas, 'pointerdown', {x: 170, y: 150});
      fireAt(canvas, 'pointermove', {x: -10, y: 75});
      fireAt(canvas, 'pointerup', {x: -10, y: 75});
    });

    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(5);
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(0);
  });

  it('can be STARTED from empty lyrics-row space, not just dragged into it', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      // x=200,y=32 is in the lyrics row (24-46) but past both chips and the
      // single phrase's band/edges (phrase 0..960 ticks ≈ 0..70px here) — a
      // miss on everything the row would otherwise grab. Drag down through
      // the tempo lane into the note lanes and left across every note.
      fireAt(canvas, 'pointerdown', {x: 200, y: 32});
      fireAt(canvas, 'pointermove', {x: -10, y: 150});
      fireAt(canvas, 'pointerup', {x: -10, y: 150});
    });

    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(5);
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(2);
  });

  it('a horizontal-only drag confined to the lyrics row does NOT select notes', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      // Regression: `marqueeBounds`' lane math clamps any y to a valid lane
      // index, even far outside the note-lane band — a purely horizontal
      // drag that never leaves the lyrics row (y stays at 32 throughout)
      // used to resolve to lane 0 (red) and sweep up red notes whose ms
      // range happened to overlap. Selects both lyrics (240 and 720) but
      // must select ZERO notes.
      fireAt(canvas, 'pointerdown', {x: 200, y: 32});
      fireAt(canvas, 'pointermove', {x: -10, y: 32});
      fireAt(canvas, 'pointerup', {x: -10, y: 32});
    });

    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(0);
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(2);
  });

  it('a plain click (no drag) on empty lyrics-row space clears the selection, same as empty note-lane space', async () => {
    const {canvas, stateRef} = await mountPanel();

    // Select something first so there's something to clear.
    act(() => {
      click(canvas, LYRIC_240.x, LYRIC_240.y);
    });
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(1);

    act(() => {
      click(canvas, 200, 32);
    });
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(0);
    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(0);
  });

  it('starting on a lyric chip still drags it instead of starting a marquee', async () => {
    const {canvas, stateRef} = await mountPanel();

    // pointerdown is its own `act()` — it dispatches the chip's selection,
    // and `endPointer`'s commit reads that selection back off `editStateRef`
    // (synced from `state` by an effect that only flushes at an `act()`
    // boundary), so batching it with the move/up would have the commit see
    // the pre-selection (stale) state instead.
    act(() => {
      fireAt(canvas, 'pointerdown', {x: LYRIC_240.x, y: LYRIC_240.y});
    });
    act(() => {
      fireAt(canvas, 'pointermove', {x: LYRIC_240.x + 20, y: LYRIC_240.y});
      fireAt(canvas, 'pointerup', {x: LYRIC_240.x + 20, y: LYRIC_240.y});
    });

    // Only the dragged chip is selected — nothing else got swept in the way
    // a marquee would (e.g. the notes in the ms range it crossed).
    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(0);
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(1);
    const newLyricTicks = lyricTicks(stateRef.current);
    expect(newLyricTicks).not.toContain(240);
    expect(newLyricTicks).toContain(720);
  });
});

describe('dragging a mixed note+lyric selection moves both together', () => {
  it('moves the selected note(s) and lyric by the same tick delta', async () => {
    const {canvas, stateRef} = await mountPanel();

    // Build a mixed selection: two notes + one lyric, all clear of each
    // other's hit radius. Blue (tick 1440) sits in its own lane row; its x
    // is located by scanning rather than assumed, per `findNoteX`. Called
    // outside `act()` — it wraps each probe in its own `act()` internally,
    // and nesting it inside another `act()` would defer every intermediate
    // state flush to the outer call, making every probe read the same
    // (stale) selection.
    const blueX = findNoteX(canvas, stateRef, '1440:blueDrum', 116, 100, 80);
    // Each click gets its own `act()` — `selectNote`/`selectLyric` read the
    // CURRENT selection off `editStateRef` (synced from `state` by an
    // effect), so two clicks on the same entity kind batched into one
    // `act()` would have the second read the first's pre-dispatch value.
    // Real pointer events are never batched like that (each is a separate
    // native event with a render/commit/effect cycle in between).
    act(() => {
      click(canvas, RED_NOTE.x, RED_NOTE.y);
    });
    act(() => {
      click(canvas, blueX, 116, true);
    });
    act(() => {
      click(canvas, LYRIC_240.x, LYRIC_240.y, true);
    });
    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(2);
    expect(getSelectedIds(stateRef.current!, 'lyric').size).toBe(1);

    const originalDrumTicks = drumTicks(stateRef.current);
    const originalLyricTicks = lyricTicks(stateRef.current);
    expect(originalDrumTicks).toEqual([0, 480, 960, 1440, 1920]);
    expect(originalLyricTicks).toEqual([240, 720]);

    // Drag from the already-selected red note (a plain, non-shift pointerdown
    // on a member of the current selection keeps the whole group selected —
    // same rule `selectNote` uses for a single note today) by a modest,
    // grid-snapped amount (+20px = +240 ticks) that lands clear of every
    // other note's tick and keeps the lyric inside its 0..960 phrase.
    act(() => {
      fireAt(canvas, 'pointerdown', {x: RED_NOTE.x, y: RED_NOTE.y});
      fireAt(canvas, 'pointermove', {x: RED_NOTE.x + 20, y: RED_NOTE.y});
      fireAt(canvas, 'pointerup', {x: RED_NOTE.x + 20, y: RED_NOTE.y});
    });

    const newDrumTicks = drumTicks(stateRef.current);
    const newLyricTicks = lyricTicks(stateRef.current);

    // The red note (originally 480) and blue note (originally 1440) moved;
    // the kick/yellow/green notes (not selected) stayed put.
    expect(newDrumTicks).toContain(0);
    expect(newDrumTicks).toContain(960);
    expect(newDrumTicks).toContain(1920);
    const movedNoteTicks = newDrumTicks.filter(
      t => t !== 0 && t !== 960 && t !== 1920,
    );
    expect(movedNoteTicks).toHaveLength(2);
    const [movedRed, movedBlue] = movedNoteTicks;
    const delta = movedRed - 480;
    expect(delta).not.toBe(0);
    expect(movedBlue - 1440).toBe(delta);

    // The lyric rode along at the SAME tick delta as the notes, clamped to
    // its own phrase (0..960) exactly like a single-chip drag would clamp.
    expect(newLyricTicks).toContain(720);
    const movedLyric = newLyricTicks.find(t => t !== 720)!;
    expect(movedLyric).toBe(Math.max(0, Math.min(960, 240 + delta)));
  });

  it('clamps a dragged lyric to its phrase bound independently of the notes', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      click(canvas, RED_NOTE.x, RED_NOTE.y);
      click(canvas, LYRIC_240.x, LYRIC_240.y, true);
    });

    // A large rightward drag: the note (no phrase) travels the full
    // grid-snapped distance, but the lyric (phrase 0..960) clamps at 960.
    act(() => {
      fireAt(canvas, 'pointerdown', {x: RED_NOTE.x, y: RED_NOTE.y});
      fireAt(canvas, 'pointermove', {x: RED_NOTE.x + 400, y: RED_NOTE.y});
      fireAt(canvas, 'pointerup', {x: RED_NOTE.x + 400, y: RED_NOTE.y});
    });

    const newLyricTicks = lyricTicks(stateRef.current);
    expect(newLyricTicks).toContain(960);
    expect(newLyricTicks).toContain(720);
  });
});
