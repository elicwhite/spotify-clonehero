/**
 * @jest-environment jsdom
 */
/**
 * Shared highway chrome: the side-by-side highway strip is one scene on one
 * canvas, and the chart-wide chrome is drawn once for the whole strip instead
 * of once per lane.
 *
 * The two pieces of chrome are shared by different mechanisms, so the
 * assertions read different boundaries:
 *
 *   - The karaoke overlay belongs to the stage. There is exactly one stage
 *     per editor no matter how many highways are mounted, and exactly one
 *     lyrics push, driven by the active vocal part on a vocals scope and by
 *     the default part everywhere else. This suite reads `setupStage` and the
 *     stage's `setLyricsData`.
 *   - Notes and sections are the only elements a highway draws. Lanes push
 *     the whole chart projection and the highway's reconciler keeps its
 *     subset, so what a highway shows is the same at every highway count.
 *     This suite reads the element sets pushed to each highway's
 *     `SceneReconciler` (`HIGHWAY_ELEMENT_KINDS` itself is pinned by
 *     `lib/preview/highway/__tests__/highway-element-kinds.test.ts`).
 *
 * `@/lib/preview/highway` is mocked wholesale because a real stage needs a
 * WebGL context jsdom does not provide.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import HighwayEditor from '../HighwayEditor';
import {ADD_LYRICS_CAPABILITIES} from '../capabilities';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {ChartDocument} from '@/lib/chart-edit';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {EditorScope} from '../scope';
import {setupStage} from '@/lib/preview/highway';
import {
  createFakeStage as mockCreateFakeStage,
  type FakeStage,
} from './fakeStage';

// ---------------------------------------------------------------------------
// setupStage mock — see file header.
// ---------------------------------------------------------------------------

jest.mock('../../../lib/preview/highway', () => {
  const actual = jest.requireActual('../../../lib/preview/highway');
  return {
    ...actual,
    setupStage: jest.fn(() => mockCreateFakeStage()),
  };
});

const setupStageMock = setupStage as unknown as jest.Mock;

/** The stage created by the nth `setupStage` call. */
function stageAt(index: number): FakeStage {
  return setupStageMock.mock.results[index].value as FakeStage;
}

/** The only stage this editor built. */
function theStage() {
  return stageAt(0);
}

/** The kinds in the most recent element set pushed to the nth highway's
 *  reconciler. Empty when that highway has not pushed yet. */
function lastPushedKinds(index: number): string[] {
  const calls = theStage().highways[index].reconciler.setElements.mock.calls;
  if (calls.length === 0) return [];
  const elements = calls[calls.length - 1][0] as {kind: string}[];
  return elements.map(e => e.kind);
}

/**
 * Resolve every mounted lane's stage handshake. A lane awaits
 * `getReconciler()` before it can push an element set, and `waitFor` runs its
 * polls inside `act`, which holds those queued updates until the wait settles
 * - so waiting on the pushes themselves deadlocks. Flushing act directly lets
 * the handshake land.
 *
 * Each turn yields to the macrotask queue as well as the microtask queue. The
 * handshake settles on the first turn locally, but it is not purely
 * microtask-bound, and a loaded CI runner has exhausted a fixed count of bare
 * microtask flushes — so this waits on a clock instead of a turn count.
 *
 * Giving up throws. Returning quietly on timeout leaves the caller asserting
 * against a lane that never pushed, which surfaces as a baffling "expected
 * Set {bpm, section, ts}, received Set {}" rather than as the timeout it is.
 */
async function flushLanePushes(laneCount: number): Promise<void> {
  const deadlineMs = Date.now() + 5000;
  for (;;) {
    const stage = setupStageMock.mock.results.length > 0 ? theStage() : null;
    const pushed =
      stage?.highways
        .slice(0, laneCount)
        .filter(h => h.reconciler.setElements.mock.calls.length > 0) ?? [];
    if (pushed.length === laneCount) return;
    if (Date.now() >= deadlineMs) {
      throw new Error(
        `flushLanePushes(${laneCount}) timed out after 5s: only ` +
          `${pushed.length} of ${laneCount} lanes pushed an element set.`,
      );
    }
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
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
  // One non-tempo marker so a lane with the badges suppressed still pushes a
  // non-empty element set — otherwise "no bpm/ts" would pass vacuously.
  parsed.sections.push({
    name: 'Intro',
    tick: 480,
    msTime: 500,
  } as (typeof parsed.sections)[number]);
  return {parsedChart: parsed, assets: []};
}

/** A doc with two vocal parts whose lyrics differ, so the stage's single
 *  lyrics push names which part drove it. */
function makeVocalsDoc(): ChartDocument {
  const doc = makeDoc();
  const parts = doc.parsedChart.vocalTracks.parts as Record<string, unknown>;
  parts['vocals'] = {
    notePhrases: [
      {
        msTime: 0,
        msLength: 1000,
        lyrics: [{msTime: 0, text: 'default-part', msLength: 100}],
      },
    ],
  };
  parts['harm2'] = {
    notePhrases: [
      {
        msTime: 0,
        msLength: 1000,
        lyrics: [{msTime: 0, text: 'second-part', msLength: 100}],
      },
    ],
  };
  return doc;
}

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

/** Render a single-lane editor on an arbitrary scope + capability preset. */
function renderScoped(doc: ChartDocument, scope: EditorScope) {
  function ScopedHarness() {
    const {dispatch} = useChartEditorContext();
    useEffect(() => {
      dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <HighwayEditor chart={doc.parsedChart} audioManager={fakeAudioManager} />
    );
  }

  return render(
    <AudioServiceProvider>
      <ChartEditorProvider
        capabilities={ADD_LYRICS_CAPABILITIES}
        activeScope={scope}>
        <ScopedHarness />
      </ChartEditorProvider>
    </AudioServiceProvider>,
  );
}

beforeEach(() => {
  setupStageMock.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('highway shared chrome', () => {
  it('constructs exactly one stage for the whole strip regardless of highway count', async () => {
    const {showTracks} = renderHarness(['drums:expert']);
    await screen.findByTestId('highway-lane-drums:expert');
    await waitFor(() => expect(setupStageMock).toHaveBeenCalledTimes(1));

    showTracks(['drums:expert', 'guitar:expert', 'bass:expert']);
    await screen.findByTestId('highway-lane-bass:expert');
    await waitFor(() => expect(theStage().highways).toHaveLength(3));

    // Three highways, still one renderer, one canvas, one lyrics overlay.
    expect(setupStageMock).toHaveBeenCalledTimes(1);
    expect(theStage().destroy).not.toHaveBeenCalled();
  });

  it('pushes the karaoke lyrics once for the strip, not once per highway', async () => {
    renderHarness(['drums:expert', 'guitar:expert', 'bass:expert']);

    expect(
      await screen.findByTestId('highway-lane-bass:expert'),
    ).toBeInTheDocument();
    await waitFor(() => expect(theStage().highways).toHaveLength(3));

    // The lyrics live on the stage; a highway handle has no lyrics API at all.
    const handle = theStage().getHighway('drums:expert') as Record<
      string,
      unknown
    > | null;
    expect(handle).not.toBeNull();
    expect(handle).not.toHaveProperty('setLyricsData');
  });

  it('drives the stage lyrics push from the active vocal part on a vocals scope', async () => {
    const doc = makeVocalsDoc();
    renderScoped(doc, {kind: 'vocals', part: 'harm2'});

    await screen.findByTestId('highway-lane-vocals:harm2');
    await waitFor(() =>
      expect(theStage().setLyricsData).toHaveBeenCalledWith(
        [{msTime: 0, text: 'second-part', msLength: 100}],
        [{msTime: 0, msLength: 1000}],
      ),
    );
  });

  it('drives the stage lyrics push from the default vocal part on a track scope', async () => {
    const doc = makeVocalsDoc();
    renderScoped(doc, {
      kind: 'track',
      track: {instrument: 'drums', difficulty: 'expert'},
    });

    await screen.findByTestId('highway-lane-drums:expert');
    await waitFor(() =>
      expect(theStage().setLyricsData).toHaveBeenCalledWith(
        [{msTime: 0, text: 'default-part', msLength: 100}],
        [{msTime: 0, msLength: 1000}],
      ),
    );
  });

  it('pushes the same element kinds to every highway at any highway count', async () => {
    // No lane's share of the chart depends on how many lanes there are: the
    // element set is identical, and the reconciler's allowlist is what
    // decides which of it reaches the scene.
    renderHarness(['drums:expert']);
    await screen.findByTestId('highway-lane-drums:expert');
    await flushLanePushes(1);
    const alone = new Set(lastPushedKinds(0));
    expect(alone).toContain('section');

    cleanup();
    setupStageMock.mockClear();

    renderHarness(['drums:expert', 'guitar:expert', 'bass:expert']);
    await screen.findByTestId('highway-lane-bass:expert');
    await flushLanePushes(3);
    for (const index of [0, 1, 2]) {
      expect(new Set(lastPushedKinds(index))).toEqual(alone);
    }
  });

  it('mounts a second highway without unmounting the first', async () => {
    const {showTracks} = renderHarness(['drums:expert']);
    await screen.findByTestId('highway-lane-drums:expert');
    await flushLanePushes(1);

    showTracks(['drums:expert', 'guitar:expert']);
    await screen.findByTestId('highway-lane-guitar:expert');

    // Showing a second track must not cost the first highway its scene graph.
    await flushLanePushes(2);
    expect(theStage().removeHighway).not.toHaveBeenCalledWith('drums:expert');
    expect(theStage().highways).toHaveLength(2);
  });

  it('gives lanes no border or rounding of their own', async () => {
    renderHarness(['drums:expert', 'guitar:expert']);

    const lane = await screen.findByTestId('highway-lane-drums:expert');
    expect(lane.className).not.toMatch(/\bborder\b/);
    expect(lane.className).not.toMatch(/\brounded/);
  });

  it('positions every lane overlay from the same layout it pushed to the stage', async () => {
    const {container} = renderHarness(['drums:expert', 'guitar:expert']);

    await screen.findByTestId('highway-lane-guitar:expert');
    await waitFor(() => expect(theStage().setLayout).toHaveBeenCalled());

    const surface = container.querySelector('.test-highway') as HTMLElement;
    expect(surface).not.toBeNull();
    // One canvas host for the whole strip, and no CSS grid seam between lanes:
    // the gaps are cleared by the stage, not painted by the container.
    expect(surface.style.gap).toBe('');
    expect(surface.style.gridTemplateColumns).toBe('');

    const calls = theStage().setLayout.mock.calls;
    const [layout, order] = calls[calls.length - 1] as [
      {highways: {x: number; width: number}[]},
      string[],
    ];
    expect(order).toEqual(['drums:expert', 'guitar:expert']);
    expect(layout.highways).toHaveLength(2);
    for (const [index, id] of order.entries()) {
      const lane = screen.getByTestId(`highway-lane-${id}`);
      expect(lane.style.left).toBe(`${layout.highways[index].x}px`);
      expect(lane.style.width).toBe(`${layout.highways[index].width}px`);
    }
  });
});
