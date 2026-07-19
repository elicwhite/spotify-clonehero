/**
 * @jest-environment jsdom
 */
/**
 * Regression for the "right-click opens no context menu" bug (QA round 1,
 * change 2). Mounts the real PianoRollTimeline, seeds a fixture chart, and
 * drives the actual DOM event path as closely as jsdom allows.
 *
 * Root cause: on macOS, a Control-click (the common laptop secondary-click)
 * arrives as `pointerdown` with `button === 0` and `ctrlKey` set. The old
 * `handlePointerDown` gate (`if (e.button !== 0) return`) let it through, so
 * it started a left gesture and called `canvas.setPointerCapture(...)`.
 * Capturing the pointer inside the pointerdown handler suppresses the
 * following `contextmenu` event in Blink/WebKit, so the menu never opened.
 *
 * These tests pin both halves of the fix: a plain contextmenu opens the menu,
 * and a ctrl-click pointerdown must NOT start a gesture / capture the pointer.
 */

import '@testing-library/jest-dom';
import {act, render, screen} from '@testing-library/react';
import {useEffect} from 'react';
import PianoRollTimeline from '../PianoRollTimeline';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {addDrumNote, addSection, retimeChart} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {makeFixtureDoc} from '../../__tests__/fixtures';
import type {AudioManager} from '@/lib/preview/audioManager';

/** A 1/4-time doc (every beat is a downbeat) with a single tempo marker at
 *  tick 0. Any interior beat the pointer lands on is therefore already
 *  bar-aligned, so the rephase item is a no-op there regardless of exactly
 *  which beat the click maps to. */
function makeAllDownbeatsDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.timeSignatures[0] = {...parsed.timeSignatures[0], numerator: 1, denominator: 4};
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  const drums = doc.parsedChart.trackData[0];
  addDrumNote(drums, {tick: 0, type: 'kick'});
  // Reach the end of the 10s view (tick 9600 @120 BPM = 10000 ms) so every
  // beat the pointer can land on is in-span for the downbeat-flag derivation.
  addDrumNote(drums, {tick: 9600, type: 'greenDrum'});
  addSection(doc, 0, 'Intro');
  return doc;
}

beforeAll(() => {
  // jsdom ships neither ResizeObserver nor a canvas 2D context.
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
  // jsdom elements lack the Pointer Capture API.
  HTMLElement.prototype.setPointerCapture = function () {};
  HTMLElement.prototype.releasePointerCapture = function () {};
  HTMLElement.prototype.hasPointerCapture = function () {
    return false;
  };
  // Give the panel a real 800x200 box (both the container div — read by the
  // sizing effect — and the canvas), so the view fits the song predictably and
  // the click coordinates below map to known beats.
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

/** Seeds a chart into context on mount. */
function SeedDoc({make}: {make: () => ChartDocument}) {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    const doc = make();
    retimeChart(doc.parsedChart);
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
  }, [dispatch, make]);
  return null;
}

async function mountPanel(make: () => ChartDocument = makeFixtureDoc) {
  const {container} = render(
    <ChartEditorProvider>
      <SeedDoc make={make} />
      <PianoRollTimeline
        audioManager={stubAudioManager()}
        durationSeconds={10}
        audioChannels={2}
      />
    </ChartEditorProvider>,
  );
  // Flush the waveform-source effect's post-`ready` microtask inside act so the
  // source list is populated and no state update escapes the test.
  await act(async () => {
    await Promise.resolve();
  });
  const canvas = container.querySelector('canvas');
  if (!canvas) throw new Error('canvas not mounted');
  return canvas;
}

function fireAt(
  canvas: HTMLCanvasElement,
  type: string,
  {x, y, button = 0, ctrlKey = false}: {
    x: number;
    y: number;
    button?: number;
    ctrlKey?: boolean;
  },
) {
  const evt = new MouseEvent(type, {bubbles: true, cancelable: true, button, ctrlKey});
  Object.defineProperty(evt, 'offsetX', {value: x, configurable: true});
  Object.defineProperty(evt, 'offsetY', {value: y, configurable: true});
  Object.defineProperty(evt, 'pointerId', {value: 1, configurable: true});
  canvas.dispatchEvent(evt);
}

// Tempo lane sits between the ruler (24px) and the note lanes (50px).
const TEMPO_LANE = {x: 120, y: 32};

describe('PianoRollTimeline right-click context menu (real DOM path)', () => {
  it('opens the tempo-lane menu on a right-click (button 2)', async () => {
    const canvas = await mountPanel();
    act(() => {
      fireAt(canvas, 'pointerdown', {...TEMPO_LANE, button: 2});
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    expect(screen.getByText('Add tempo marker here')).toBeInTheDocument();
  });

  it('does not capture the pointer on a macOS ctrl-click (so contextmenu still fires)', async () => {
    const canvas = await mountPanel();
    const capture = jest.spyOn(canvas, 'setPointerCapture');
    act(() => {
      fireAt(canvas, 'pointerdown', {...TEMPO_LANE, button: 0, ctrlKey: true});
    });
    expect(capture).not.toHaveBeenCalled();

    // The contextmenu the OS sends next still opens the menu.
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 0, ctrlKey: true});
    });
    expect(screen.getByText('Add tempo marker here')).toBeInTheDocument();
  });

  // Change 6: the tempo-lane menu leads with the whole-song rephase, framing
  // the local mark/unmark as a meter change.
  it('offers "Make this beat 1 (rephase song)" as the primary item at a mid-bar beat', async () => {
    const canvas = await mountPanel();
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    const rephase = screen.getByRole('button', {
      name: /Make this beat 1 \(rephase song\)/,
    });
    expect(rephase).toBeEnabled();
    expect(
      screen.getByText('Insert time signature change here'),
    ).toBeInTheDocument();
    // The old wording is gone.
    expect(screen.queryByText('Mark as downbeat')).not.toBeInTheDocument();
  });

  // Change 4: right-clicking the waveform row opens the source picker.
  it('opens the waveform-source picker on a waveform-row right-click', async () => {
    const canvas = await mountPanel();
    // The corner chip shows the default source before the menu is opened.
    expect(screen.getByLabelText('Waveform source')).toHaveTextContent('Drums');

    // Waveform row is the bottom 40px of the 200px canvas (y >= 160).
    act(() => {
      fireAt(canvas, 'contextmenu', {x: 300, y: 182, button: 2});
    });
    // The mix (a non-selected source) appears only in the opened menu.
    expect(screen.getByText('Song (full mix)')).toBeInTheDocument();
    // 'Drums' now appears twice: the chip and the checked menu row.
    expect(screen.getAllByText('Drums')).toHaveLength(2);
  });

  it('disables the rephase item at an already bar-aligned beat', async () => {
    const canvas = await mountPanel(makeAllDownbeatsDoc);
    // 1/4 time → whichever interior beat this maps to is a downbeat, so the
    // whole-song rephase would be a no-op → the item is disabled.
    act(() => {
      fireAt(canvas, 'contextmenu', {x: 400, y: 32, button: 2});
    });
    expect(
      screen.getByRole('button', {name: /Make this beat 1 \(rephase song\)/}),
    ).toBeDisabled();
  });
});
