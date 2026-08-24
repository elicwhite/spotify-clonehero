/**
 * @jest-environment jsdom
 */
/**
 * A pointer-down in a stacked piano-roll row makes that row's track the
 * active scope.
 *
 * The bug this pins: selection ids are stored track-qualified
 * (`guitar:expert|480:green`), and everything downstream of the selection
 * resolves them through `activeScope` — `activeNoteIds` in
 * `useEditorKeyboard` keeps only the ids whose track matches, and both the
 * Delete/Backspace hotkey's `enabled` gate and its command list read that.
 *
 * `HighwayLane.handleMouseDown` has always retargeted the scope on a
 * pointer-down ("last-interacted" semantics, plan 0074). The piano roll
 * never did. So a marquee on any row other than the active one filed its
 * ids under that row's track while the scope still named the old one,
 * `activeNoteIds` resolved to the empty set, and Delete silently did
 * nothing — which is why it worked on drums (the default scope) and not on
 * a guitar row.
 */

import '@testing-library/jest-dom';
import {act, render} from '@testing-library/react';
import {useEffect} from 'react';
import PianoRollTimeline from '../PianoRollTimeline';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import {
  addDrumNote,
  addNote,
  guitarSchema,
  retimeChart,
} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {localNoteIdsForTrack, trackKeyFromScope} from '../../scope';
import {getSelectedIds} from '@/lib/chart-editor-core';
import {
  STACKED_GUTTER_W,
  STACKED_LANE_H,
  STACKED_ROW_HEADER_H,
} from '../sceneTypes';
import {schemaForTrack} from '@/lib/chart-edit';
import {availableTrackKeys} from '@/lib/chart-editor-core/trackInventory';
import type {AudioManager} from '@/lib/preview/audioManager';

beforeAll(() => {
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const ctxStub = new Proxy(
    {measureText: () => ({width: 10}), canvas: {width: 800, height: 400}},
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
      height: 400,
      top: 0,
      left: 0,
      right: 800,
      bottom: 400,
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
    pause: () => {},
    getCurrentTempo: () => 1,
  } as unknown as AudioManager;
}

/** Drums + guitar, each with notes, so the stacked layout has two rows whose
 *  tracks are different instruments. */
function makeDrumsAndGuitarDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  parsed.trackData.push(emptyTrackData('guitar', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  addDrumNote(doc.parsedChart.trackData[0], {
    tick: 480,
    type: noteTypes.redDrum,
  });
  addNote(
    doc.parsedChart.trackData[1],
    {tick: 0, type: noteTypes.green},
    guitarSchema,
  );
  addNote(
    doc.parsedChart.trackData[1],
    {tick: 480, type: noteTypes.red},
    guitarSchema,
  );
  return doc;
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

function SeedVisibleTracks({trackIds}: {trackIds: string[]}) {
  const {state, dispatch} = useChartEditorContext();
  useEffect(() => {
    if (!state.chartDoc) return;
    dispatch({type: 'SET_VISIBLE_TRACKS', tracks: new Set(trackIds)});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chartDoc, dispatch]);
  return null;
}

let latest: ReturnType<typeof useChartEditorContext>['state'] | null = null;

function Probe() {
  const {state} = useChartEditorContext();
  useEffect(() => {
    latest = state;
  }, [state]);
  return null;
}

async function mountStacked() {
  latest = null;
  const {container} = render(
    <ChartEditorProvider>
      <SeedDoc make={makeDrumsAndGuitarDoc} />
      <SeedVisibleTracks trackIds={['drums:expert', 'guitar:expert']} />
      <Probe />
      <PianoRollTimeline
        audioManager={stubAudioManager()}
        durationSeconds={10}
        audioChannels={2}
        stackedPianoRoll
      />
    </ChartEditorProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  const canvas = container.querySelector<HTMLCanvasElement>(
    'canvas[data-piano-roll-region="rows"]',
  );
  if (!canvas) throw new Error('stacked rows canvas not mounted');
  return canvas;
}

/**
 * Center of each row's lane band, in rows-canvas offset pixels.
 *
 * Mirrors `stackedRowGeometry`: rows stack in `availableTrackKeys` order —
 * which is `SUPPORTED_TRACK_INSTRUMENTS` order, so guitar precedes drums,
 * not doc-track order — each `STACKED_ROW_HEADER_H + laneCount *
 * STACKED_LANE_H` tall, with the rows canvas starting at the first row's
 * top. Both the order and the lane counts come from the same helpers the
 * component uses, so a schema or ordering change moves the test with it
 * rather than silently aiming at the wrong row.
 */
function rowCenters(doc: ChartDocument): Map<string, number> {
  const centers = new Map<string, number>();
  let cursor = 0;
  for (const key of availableTrackKeys(doc.parsedChart.trackData)) {
    const track = doc.parsedChart.trackData.find(
      t => t.instrument === key.instrument && t.difficulty === key.difficulty,
    )!;
    const lanes =
      schemaForTrack(track, doc.parsedChart.drumType)?.lanes.length ?? 1;
    centers.set(
      key.instrument,
      cursor + STACKED_ROW_HEADER_H + (lanes * STACKED_LANE_H) / 2,
    );
    cursor += STACKED_ROW_HEADER_H + lanes * STACKED_LANE_H;
  }
  return centers;
}

const CENTERS = rowCenters(makeDrumsAndGuitarDoc());
const DRUMS_Y = CENTERS.get('drums')!;
const GUITAR_Y = CENTERS.get('guitar')!;
/** Any x right of the gutter; left of it the handlers return early. */
const X = STACKED_GUTTER_W + 100;

function fireAt(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(evt, 'offsetX', {value: x, configurable: true});
  Object.defineProperty(evt, 'offsetY', {value: y, configurable: true});
  Object.defineProperty(evt, 'pointerId', {value: 1, configurable: true});
  canvas.dispatchEvent(evt);
}

/**
 * The invariant. Whatever row the pointer landed in, the selection it
 * produced has to be reachable through `activeScope` — that is exactly what
 * `useEditorKeyboard.activeNoteIds` computes before deciding whether Delete
 * is enabled and what it deletes.
 */
function selectionIsReachable(): boolean {
  const state = latest!;
  const selected = getSelectedIds(state, 'note');
  if (selected.size === 0) return true;
  const trackKey = trackKeyFromScope(state.activeScope);
  if (!trackKey) return false;
  return localNoteIdsForTrack(selected, trackKey).length === selected.size;
}

function activeInstrument(): string | null {
  const scope = latest!.activeScope;
  return scope.kind === 'track' ? scope.track.instrument : null;
}

async function press(
  canvas: HTMLCanvasElement,
  type: string,
  x: number,
  y: number,
) {
  await act(async () => {
    fireAt(canvas, type, x, y);
  });
}

async function click(canvas: HTMLCanvasElement, y: number) {
  await press(canvas, 'pointerdown', X, y);
  await press(canvas, 'pointerup', X, y);
}

it('claims the row a left-click lands in', async () => {
  const canvas = await mountStacked();

  await click(canvas, GUITAR_Y);
  expect(activeInstrument()).toBe('guitar');

  await click(canvas, DRUMS_Y);
  expect(activeInstrument()).toBe('drums');
});

it('claims the row a right-click lands in', async () => {
  // A right-click never reaches `handlePointerDown` — it returns early on any
  // non-left button — but `buildNoteMenu` still files a track-qualified
  // selection, so the context-menu path has to claim too.
  const canvas = await mountStacked();
  await click(canvas, DRUMS_Y);
  expect(activeInstrument()).toBe('drums');

  await act(async () => {
    const evt = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    Object.defineProperty(evt, 'offsetX', {value: X, configurable: true});
    Object.defineProperty(evt, 'offsetY', {
      value: GUITAR_Y,
      configurable: true,
    });
    canvas.dispatchEvent(evt);
  });

  expect(activeInstrument()).toBe('guitar');
});

it('leaves a marquee on the guitar row reachable by Delete', async () => {
  const canvas = await mountStacked();
  await click(canvas, DRUMS_Y);

  await press(canvas, 'pointerdown', STACKED_GUTTER_W + 5, GUITAR_Y);
  await press(canvas, 'pointermove', 700, GUITAR_Y);
  await press(canvas, 'pointerup', 700, GUITAR_Y);

  expect(activeInstrument()).toBe('guitar');
  expect(selectionIsReachable()).toBe(true);
});

it('keeps each row selection reachable as the pointer moves between them', async () => {
  const canvas = await mountStacked();
  for (const y of [DRUMS_Y, GUITAR_Y, DRUMS_Y, GUITAR_Y]) {
    await click(canvas, y);
    expect(selectionIsReachable()).toBe(true);
  }
});
