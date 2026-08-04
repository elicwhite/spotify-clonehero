/**
 * @jest-environment jsdom
 */
/**
 * Shared highway chrome (owner feedback 2026-08-03): side-by-side highway
 * panes read as one surface, and the chart-wide chrome each pane's renderer
 * could draw — the karaoke lyrics overlay and the BPM / time-signature
 * badges — is drawn once for the whole area instead of once per pane.
 *
 * The two pieces of chrome are shared by different mechanisms, so the
 * assertions read different boundaries:
 *
 *   - The karaoke overlay is a second WebGL pass inside a pane's own canvas,
 *     so it can only be suppressed per canvas. `HighwayPreview` passes
 *     `showLyrics` in the `RendererConfig`, and this suite reads the config
 *     each pane's `setupRenderer` call received.
 *   - The BPM / time-signature badges are ordinary marker elements, so a
 *     pane that should not show them simply never produces them. This suite
 *     reads the element sets pushed to each pane's `SceneReconciler`.
 *
 * `@/lib/preview/highway` is mocked wholesale because a real renderer needs
 * a WebGL context jsdom does not provide.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {act, render, screen, waitFor} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import HighwayEditor from '../HighwayEditor';
import {ADD_LYRICS_CAPABILITIES} from '../capabilities';
import {DEFAULT_VOCALS_SCOPE} from '../scope';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {ChartDocument} from '@/lib/chart-edit';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {setupRenderer} from '@/lib/preview/highway';

// ---------------------------------------------------------------------------
// setupRenderer mock — see file header.
// ---------------------------------------------------------------------------

function mockMakeRenderer() {
  const interactionManager = {
    hitTest: jest.fn(() => null),
    screenToLane: jest.fn(() => 0),
    screenToMs: jest.fn(() => 0),
    screenToTick: jest.fn(() => 0),
    setTimingData: jest.fn(),
    dispose: jest.fn(),
  };
  const reconciler = {
    setElements: jest.fn(),
    setHoveredKey: jest.fn(),
    setSelectedKeys: jest.fn(),
    dispose: jest.fn(),
  };
  return {
    reconciler,
    prepTrack: jest.fn(async () => {}),
    startRender: jest.fn(async () => {}),
    destroy: jest.fn(async () => {}),
    getCamera: jest.fn(),
    getHighwaySpeed: jest.fn(() => 1.5),
    setOverlayState: jest.fn(),
    setTimingData: jest.fn(async () => {}),
    getInteractionManager: jest.fn(async () => interactionManager),
    getReconciler: jest.fn(async () => reconciler),
    getNoteRenderer: jest.fn(async () => ({dispose: jest.fn()})),
    setWaveformData: jest.fn(async () => {}),
    setGridData: jest.fn(async () => {}),
    setLyricsData: jest.fn(async () => {}),
    setLyricsVisible: jest.fn(),
    setHighwayMode: jest.fn(),
    getHighwayMode: jest.fn(() => 'classic' as const),
  };
}

jest.mock('../../../lib/preview/highway', () => {
  const actual = jest.requireActual('../../../lib/preview/highway');
  return {
    ...actual,
    setupRenderer: jest.fn(() => mockMakeRenderer()),
  };
});

const setupRendererMock = setupRenderer as unknown as jest.Mock;

/** The `RendererConfig` (6th argument) of every `setupRenderer` call, in
 *  creation order. */
function rendererConfigs(): {showLyrics?: boolean}[] {
  return setupRendererMock.mock.calls.map(call => call[5]);
}

/** The kinds in the most recent element set pushed to the nth pane's
 *  reconciler. Empty when that pane has not pushed yet. */
function lastPushedKinds(index: number): string[] {
  const calls = rendererAt(index).reconciler.setElements.mock.calls;
  if (calls.length === 0) return [];
  const elements = calls[calls.length - 1][0] as {kind: string}[];
  return elements.map(e => e.kind);
}

/** Whether the nth pane's most recent push carries the chart-wide BPM /
 *  time-signature badge markers. */
function hasTempoBadges(index: number): boolean {
  const kinds = lastPushedKinds(index);
  return kinds.includes('bpm') && kinds.includes('ts');
}

/**
 * Resolve every mounted pane's renderer handshake. A pane awaits
 * `getReconciler()` before it can push an element set, and `waitFor` runs its
 * polls inside `act`, which holds those queued updates until the wait
 * settles - so waiting on the pushes themselves deadlocks. Flushing act
 * directly lets the handshake land.
 */
async function flushPanePushes(paneCount: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const pushed = setupRendererMock.mock.results
      .slice(0, paneCount)
      .filter(
        r =>
          (r.value as ReturnType<typeof mockMakeRenderer>).reconciler
            .setElements.mock.calls.length > 0,
      );
    if (pushed.length === paneCount) return;
    await act(async () => {});
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  parsed.trackData.push(emptyTrackData('guitar', 'expert'));
  parsed.trackData.push(emptyTrackData('bass', 'expert'));
  // One non-tempo marker so a pane with the badges suppressed still pushes a
  // non-empty element set — otherwise "no bpm/ts" would pass vacuously.
  parsed.sections.push({
    name: 'Intro',
    tick: 480,
    msTime: 500,
  } as (typeof parsed.sections)[number]);
  return {parsedChart: parsed, assets: []};
}

/** Stable identity: `HighwayPreview` recreates its renderer when `metadata`
 *  changes, so a fresh object per render would inflate the call count. */
const metadata = {song_length: 60_000} as ChartResponseEncore;

const fakeAudioManager = {} as AudioManager;

function Harness({
  chartDoc,
  visible,
}: {
  chartDoc: ChartDocument;
  visible: string[];
}) {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const visibleKey = visible.join(',');
  useEffect(() => {
    dispatch({
      type: 'SET_VISIBLE_TRACKS',
      tracks: new Set(visibleKey.split(',')),
    });
  }, [visibleKey, dispatch]);
  return (
    <HighwayEditor
      metadata={metadata}
      chart={chartDoc.parsedChart}
      audioManager={fakeAudioManager}
      className="test-highway"
    />
  );
}

function renderHarness(visible: string[]) {
  const doc = makeDoc();
  const tree = (shown: string[]) => (
    <AudioServiceProvider>
      <ChartEditorProvider>
        <Harness chartDoc={doc} visible={shown} />
      </ChartEditorProvider>
    </AudioServiceProvider>
  );
  const result = render(tree(visible));
  return {
    ...result,
    /** Show a different set of tracks in the same mounted editor. */
    showTracks: (shown: string[]) => result.rerender(tree(shown)),
  };
}

/** The mock renderer handed back by the nth `setupRenderer` call. */
function rendererAt(index: number) {
  return setupRendererMock.mock.results[index].value as ReturnType<
    typeof mockMakeRenderer
  >;
}

beforeEach(() => {
  setupRendererMock.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('highway shared chrome', () => {
  it('draws lyrics and tempo badges in a single-pane highway', async () => {
    renderHarness(['drums:expert']);

    expect(
      await screen.findByTestId('highway-pane-drums:expert'),
    ).toBeInTheDocument();
    await waitFor(() => expect(rendererConfigs()).toHaveLength(1));
    expect(rendererConfigs()[0].showLyrics).toBe(true);
    await flushPanePushes(1);
    expect(hasTempoBadges(0)).toBe(true);
  });

  it('draws lyrics in the leftmost pane only when panes sit side by side', async () => {
    renderHarness(['drums:expert', 'guitar:expert', 'bass:expert']);

    expect(
      await screen.findByTestId('highway-pane-bass:expert'),
    ).toBeInTheDocument();
    await waitFor(() => expect(rendererConfigs()).toHaveLength(3));
    expect(rendererConfigs().map(c => c.showLyrics)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('produces no tempo badge markers in any pane when panes sit side by side', async () => {
    renderHarness(['drums:expert', 'guitar:expert', 'bass:expert']);

    expect(
      await screen.findByTestId('highway-pane-bass:expert'),
    ).toBeInTheDocument();
    await waitFor(() => expect(rendererConfigs()).toHaveLength(3));
    await flushPanePushes(3);
    for (const index of [0, 1, 2]) {
      const kinds = lastPushedKinds(index);
      expect(kinds).toContain('section');
      expect(kinds).not.toContain('bpm');
      expect(kinds).not.toContain('ts');
    }
  });

  it('keeps the shared chrome on for a single vocals pane', async () => {
    const doc = makeDoc();

    function VocalsHarness() {
      const {dispatch} = useChartEditorContext();
      useEffect(() => {
        dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <HighwayEditor
          metadata={metadata}
          chart={doc.parsedChart}
          audioManager={fakeAudioManager}
        />
      );
    }

    render(
      <AudioServiceProvider>
        <ChartEditorProvider
          capabilities={ADD_LYRICS_CAPABILITIES}
          activeScope={DEFAULT_VOCALS_SCOPE}>
          <VocalsHarness />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    expect(
      await screen.findByTestId('highway-pane-vocals:vocals'),
    ).toBeInTheDocument();
    await waitFor(() => expect(rendererConfigs()).toHaveLength(1));
    expect(rendererConfigs()[0].showLyrics).toBe(true);
    await flushPanePushes(1);
    expect(hasTempoBadges(0)).toBe(true);
  });

  it('reassigns the shared chrome without rebuilding a surviving pane', async () => {
    const {showTracks} = renderHarness(['drums:expert']);
    await screen.findByTestId('highway-pane-drums:expert');
    await waitFor(() => expect(rendererConfigs()).toHaveLength(1));
    await flushPanePushes(1);
    expect(hasTempoBadges(0)).toBe(true);
    const drumsRenderer = rendererAt(0);

    showTracks(['drums:expert', 'guitar:expert']);
    await screen.findByTestId('highway-pane-guitar:expert');

    // The drums pane loses the tempo badges now that it has a neighbour, and
    // stops producing them on its next element push — showing a second track
    // must not cost the first pane its WebGL context.
    await flushPanePushes(2);
    expect(hasTempoBadges(0)).toBe(false);
    expect(drumsRenderer.destroy).not.toHaveBeenCalled();
    expect(setupRendererMock).toHaveBeenCalledTimes(2);
  });

  it('gives panes no border or rounding of their own', async () => {
    renderHarness(['drums:expert', 'guitar:expert']);

    const pane = await screen.findByTestId('highway-pane-drums:expert');
    expect(pane.className).not.toMatch(/\bborder\b/);
    expect(pane.className).not.toMatch(/\brounded/);
    // The pane's own canvas wrapper is equally unadorned.
    const canvasWrapper = pane.querySelector('.h-full.w-full');
    expect(canvasWrapper?.className).not.toMatch(/\bborder\b/);
  });

  it('seats the panes flush in one surface separated by a hairline', async () => {
    const {container} = renderHarness(['drums:expert', 'guitar:expert']);

    await screen.findByTestId('highway-pane-guitar:expert');
    const surface = container.querySelector('.test-highway') as HTMLElement;
    expect(surface).not.toBeNull();
    expect(surface.className).not.toMatch(/\brounded/);
    expect(surface.style.gap).toBe('1px');
    expect(surface.style.gridTemplateColumns).toBe('repeat(2, 1fr)');
  });
});
