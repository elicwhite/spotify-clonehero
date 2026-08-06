/**
 * @jest-environment jsdom
 */
/**
 * The waveform row draws the source that is selected.
 *
 * The panel used to shortcut the DEFAULT source to the host's `audioData`
 * prop, on the assumption that a host passes the default source's PCM. The
 * chart editor passes the padded full mix unconditionally while the default
 * source is the drum stem whenever one exists, so picking "Drums" drew the
 * full mix. The source's bytes now always come from the AudioManager, which
 * is the only thing that knows what a track name maps to.
 */

import {act, render} from '@testing-library/react';
import {useEffect} from 'react';
import PianoRollTimeline from '../PianoRollTimeline';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
import {makeFixtureDoc} from '../../__tests__/fixtures';
import {retimeChart} from '@/lib/chart-edit';
import type {AudioManager} from '@/lib/preview/audioManager';

/** Distinct PCM per track, so a wrong pick is visible in the request log. */
const PCM: Record<string, {data: Float32Array; channels: number}> = {
  drums: {data: new Float32Array([1, 1, 1, 1]), channels: 2},
  song: {data: new Float32Array([0.5, 0.5, 0.5, 0.5]), channels: 2},
};

beforeAll(() => {
  // jsdom ships neither ResizeObserver nor a canvas 2D context.
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const ctxStub = new Proxy(
    {measureText: () => ({width: 10}), canvas: {width: 800, height: 200}},
    {
      get: (target, prop) =>
        prop in target
          ? (target as Record<string | symbol, unknown>)[prop]
          : () => {},
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    ctxStub) as unknown as HTMLCanvasElement['getContext'];
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

function SeedDoc() {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    const doc = makeFixtureDoc();
    retimeChart(doc.parsedChart);
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
  }, [dispatch]);
  return null;
}

async function mount(requested: string[]) {
  const audioManager = {
    chartTime: 0,
    isPlaying: false,
    duration: 10,
    chartDelay: 0,
    ready: Promise.resolve(),
    trackNames: ['song', 'drums'],
    getTrackPcm: (name: string) => {
      requested.push(name);
      return PCM[name] ?? null;
    },
    seekToChartTime: () => {},
    playChartTime: () => {},
    pause: () => {},
    getCurrentTempo: () => 1,
  } as unknown as AudioManager;

  render(
    <ChartEditorProvider>
      <SeedDoc />
      <PianoRollTimeline
        audioManager={audioManager}
        durationSeconds={10}
        audioChannels={2}
        // What the chart editor passes: the full mix, whatever is selected.
        audioData={PCM['song'].data}
      />
    </ChartEditorProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

describe('waveform source PCM', () => {
  it('asks the AudioManager for the default source rather than reusing audioData', async () => {
    const requested: string[] = [];
    await mount(requested);
    // 'drums' is the default when a drum stem exists, so it is what must be
    // fetched — not silently swapped for the host's full-mix buffer.
    expect(requested).toContain('drums');
    expect(requested).not.toContain('song');
  });
});
