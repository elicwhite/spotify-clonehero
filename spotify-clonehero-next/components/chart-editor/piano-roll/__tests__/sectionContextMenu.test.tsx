/**
 * @jest-environment jsdom
 */
/**
 * Section strip (ruler) right-click context menu (plan 0076 item 19).
 *
 * The section tool button that used to live in the utility cluster is gone
 * (see utility-cluster.test.tsx); its replacement is this menu. Mounts the
 * real PianoRollTimeline and drives the actual pointer/contextmenu event
 * path, asserting through the real reducer (`ChartEditorContext`) rather
 * than mocking `executeCommand` — the same style as `contextMenu.test.tsx`
 * and `lyricSelection.test.tsx`.
 */

import '@testing-library/jest-dom';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {useEffect} from 'react';
import PianoRollTimeline from '../PianoRollTimeline';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
import type {ChartEditorState} from '@/lib/chart-editor-core';
import {
  DRUM_EDIT_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  type EditorCapabilities,
} from '../../capabilities';
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

function StateCapture({outRef}: {outRef: {current: ChartEditorState | null}}) {
  const {state} = useChartEditorContext();
  useEffect(() => {
    outRef.current = state;
  });
  return null;
}

async function mountPanel(
  make: () => ChartDocument = makeFixtureDoc,
  capabilities: EditorCapabilities = DRUM_EDIT_CAPABILITIES,
) {
  const stateRef: {current: ChartEditorState | null} = {current: null};
  const {container} = render(
    <ChartEditorProvider capabilities={capabilities}>
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
  {x, y, button = 0}: {x: number; y: number; button?: number},
) {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
  });
  Object.defineProperty(evt, 'offsetX', {value: x, configurable: true});
  Object.defineProperty(evt, 'offsetY', {value: y, configurable: true});
  Object.defineProperty(evt, 'pointerId', {value: 1, configurable: true});
  canvas.dispatchEvent(evt);
}

function sections(state: ChartEditorState | null) {
  return (state?.chartDoc?.parsedChart.sections ?? [])
    .map(s => ({tick: s.tick, name: s.name}))
    .sort((a, b) => a.tick - b.tick);
}

// makeFixtureDoc (120 BPM, resolution 480) puts "Intro" at tick 0 (ms 0) and
// "Verse" at tick 1920 (ms 2000). At the panel's fit-to-width scale for a
// 10s doc (~0.08 px/ms) that's x≈0 and x≈160; both fall inside the ruler
// band (y 0-24). x=700 (ms≈8750) sits well clear of either flag's
// hit-region (fixed 10px `measureText` stub → ~25px wide) and empty ruler
// space beyond it, so it always resolves to "Add section here".
const INTRO_FLAG = {x: 8, y: 10};
const EMPTY_RULER = {x: 700, y: 10};

describe('PianoRollTimeline section-strip context menu (item 19)', () => {
  it('offers "Add section here" on empty ruler space and creates a section via the real reducer', async () => {
    const {canvas, stateRef} = await mountPanel();
    expect(sections(stateRef.current)).toHaveLength(2);

    act(() => {
      fireAt(canvas, 'contextmenu', {...EMPTY_RULER, button: 2});
    });
    const addItem = screen.getByText('Add section here');
    expect(addItem).toBeInTheDocument();

    act(() => {
      fireEvent.click(addItem);
    });

    const input = screen.getByRole('textbox');
    act(() => {
      fireEvent.change(input, {target: {value: 'Bridge'}});
      fireEvent.keyDown(input, {key: 'Enter'});
    });

    const after = sections(stateRef.current);
    expect(after).toHaveLength(3);
    expect(after.map(s => s.name)).toContain('Bridge');
  });

  it('does not add a section when the inline input is committed empty', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      fireAt(canvas, 'contextmenu', {...EMPTY_RULER, button: 2});
    });
    act(() => {
      fireEvent.click(screen.getByText('Add section here'));
    });
    const input = screen.getByRole('textbox');
    act(() => {
      fireEvent.keyDown(input, {key: 'Enter'});
    });

    expect(sections(stateRef.current)).toHaveLength(2);
  });

  it('offers rename/delete on an existing section flag and renames it via the real reducer', async () => {
    const {canvas, stateRef} = await mountPanel();

    act(() => {
      fireAt(canvas, 'contextmenu', {...INTRO_FLAG, button: 2});
    });
    expect(screen.getByText('Rename section…')).toBeInTheDocument();
    expect(screen.getByText('Delete section')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByText('Rename section…'));
    });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.defaultValue).toBe('Intro');
    act(() => {
      fireEvent.change(input, {target: {value: 'Opening'}});
      fireEvent.keyDown(input, {key: 'Enter'});
    });

    expect(sections(stateRef.current)).toContainEqual({
      tick: 0,
      name: 'Opening',
    });
  });

  it('deletes an existing section flag via the context menu', async () => {
    const {canvas, stateRef} = await mountPanel();
    expect(sections(stateRef.current)).toHaveLength(2);

    act(() => {
      fireAt(canvas, 'contextmenu', {...INTRO_FLAG, button: 2});
    });
    act(() => {
      fireEvent.click(screen.getByText('Delete section'));
    });

    const after = sections(stateRef.current);
    expect(after).toHaveLength(1);
    expect(after.map(s => s.name)).not.toContain('Intro');
  });

  it('offers no section menu at all on a read-only surface', async () => {
    // The preview viewer can't edit sections, and the session's command gate
    // would drop these edits anyway - so the ruler stays as menu-less as it
    // was before item 19 rather than showing entries that silently no-op.
    const {canvas} = await mountPanel(makeFixtureDoc, PREVIEW_CAPABILITIES);

    act(() => {
      fireAt(canvas, 'contextmenu', {...EMPTY_RULER, button: 2});
    });
    expect(screen.queryByText('Add section here')).not.toBeInTheDocument();

    act(() => {
      fireAt(canvas, 'contextmenu', {...INTRO_FLAG, button: 2});
    });
    expect(screen.queryByText('Rename section…')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete section')).not.toBeInTheDocument();
  });
});
