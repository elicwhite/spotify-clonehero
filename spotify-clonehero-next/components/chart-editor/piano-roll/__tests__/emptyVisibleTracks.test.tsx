/**
 * @jest-environment jsdom
 */
/**
 * Item 1's empty case: with every Chart Matrix track hidden, the piano
 * roll's stacked row list has nothing to show. It must render a sane empty
 * state (no note-lane rows, a real canvas height) instead of crashing or
 * collapsing to a zero-height canvas.
 */

import '@testing-library/jest-dom';
import {act, render} from '@testing-library/react';
import {useEffect} from 'react';
import PianoRollTimeline from '../PianoRollTimeline';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
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

/** Seeds a chart, then — once it lands — hides every track the Chart Matrix
 *  would otherwise default one of to (`SET_TRACK_VISIBILITY`, false, for
 *  each), landing on the reachable-but-untested `visibleTrackKeys.size ===
 *  0` state (unlike `SET_VISIBLE_TRACKS`, this path has no
 *  preferred-track fallback). */
function SeedDocThenHideEverything({make}: {make: () => ChartDocument}) {
  const {state, dispatch} = useChartEditorContext();
  useEffect(() => {
    if (state.chartDoc) return;
    const doc = make();
    retimeChart(doc.parsedChart);
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chartDoc, dispatch]);
  useEffect(() => {
    if (!state.chartDoc || state.visibleTrackKeys.size === 0) return;
    for (const track of state.chartDoc.parsedChart.trackData) {
      dispatch({
        type: 'SET_TRACK_VISIBILITY',
        track: {instrument: track.instrument, difficulty: track.difficulty},
        visible: false,
      });
    }
  }, [state.chartDoc, state.visibleTrackKeys, dispatch]);
  return null;
}

describe('PianoRollTimeline with zero Chart-Matrix-visible tracks', () => {
  it('mounts without crashing and gives the canvas a real (non-zero) height', async () => {
    const {container} = render(
      <ChartEditorProvider>
        <SeedDocThenHideEverything make={makeFixtureDoc} />
        <PianoRollTimeline
          audioManager={stubAudioManager()}
          durationSeconds={10}
          audioChannels={2}
        />
      </ChartEditorProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.height).toBeGreaterThan(0);
  });
});
