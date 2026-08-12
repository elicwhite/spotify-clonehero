/**
 * @jest-environment jsdom
 */
/**
 * Multi-pane highway (plan 0074 Phase 3, Suite 4): `HighwayEditor` renders
 * one pane per visible track, caps the count at however many lanes the
 * measured canvas width holds with a "+N more" overflow chip, and each pane's
 * interaction hooks target that pane's own track — never the
 * globally-last-set `activeScope` of some other pane.
 *
 * `@/lib/preview/highway`'s `setupStage` is mocked wholesale: a real stage
 * would need a WebGL context jsdom doesn't provide. The fake stage's
 * `addHighway` resolves a handle whose `getInteractionManager()` yields a
 * stub with a per-track `hitTest` (via `mockTrackHits`), so pointer events
 * drive the REAL `useHighwayMouseInteraction` / tool-registry / command stack
 * end to end — only the THREE.js boundary is faked.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import HighwayEditor from '../HighwayEditor';
import {addDrumNote, addNote, guitarSchema} from '@/lib/chart-edit';
import {useEditorKeyboard} from '../hooks/useEditorKeyboard';
import PianoRollTimeline from '../piano-roll/PianoRollTimeline';
import {
  ADD_LYRICS_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  TEMPO_CAPABILITIES,
  type EditorCapabilities,
} from '../capabilities';
import {
  DEFAULT_DRUMS_EXPERT_SCOPE,
  DEFAULT_GUITAR_EXPERT_SCOPE,
  DEFAULT_VOCALS_SCOPE,
  type EditorScope,
} from '../scope';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {ChartDocument} from '@/lib/chart-edit';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {HitResult} from '@/lib/preview/highway';
import {
  createFakeStage as mockCreateFakeStage,
  type FakeHighway,
  type FakeStage,
} from './fakeStage';

// ---------------------------------------------------------------------------
// setupStage mock — see file header.
// ---------------------------------------------------------------------------

/** hitTest result each fake highway's InteractionManager returns, keyed by
 *  `"${instrument}:${difficulty}"`. Set per-test before rendering. */
const mockTrackHits: Record<string, HitResult> = {};

/** Every highway mounted on any fake stage, in mount order -- lets tests
 *  assert which track a highway drew and that removal disposed the right one. */
const mockStageHighways: FakeHighway[] = [];

/** Every fake stage created, in creation order. */
const mockStages: FakeStage[] = [];

function mockMakeStage(): FakeStage {
  const stage = mockCreateFakeStage({
    onHighwayMounted: highway => {
      mockStageHighways.push(highway);
      if (highway.track) {
        const key = `${highway.track.instrument}:${highway.track.difficulty}`;
        highway.interactionManager.hitTest.mockReturnValue(
          mockTrackHits[key] ?? null,
        );
      }
    },
  });
  mockStages.push(stage);
  return stage;
}

// jest.mock's string argument is a literal Jest resolves itself (unlike a
// real `import`, which Next's SWC alias transform rewrites at compile
// time) -- a relative path is required here so Jest's resolver can find
// the module directly. Jest keys mocks by resolved absolute path, so this
// still intercepts every `@/lib/preview/highway` import site.
jest.mock('../../../lib/preview/highway', () => {
  const actual = jest.requireActual('../../../lib/preview/highway');
  return {
    ...actual,
    setupStage: jest.fn(() => mockMakeStage()),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMultiInstrumentDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  parsed.trackData.push(emptyTrackData('guitar', 'expert'));
  parsed.trackData.push(emptyTrackData('bass', 'expert'));
  // Fourth and fifth charted tracks: let a test fill the four lanes a 900 px
  // canvas holds and then exceed them to exercise the overflow chip.
  parsed.trackData.push(emptyTrackData('guitar', 'hard'));
  parsed.trackData.push(emptyTrackData('guitar', 'medium'));
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
    doc.parsedChart.trackData[2],
    {tick: 0, type: noteTypes.green},
    guitarSchema,
  );
  // Guitar Hard is a reduction of Expert: the SAME local note id
  // ("480:green") exists in both, which is what makes an unqualified
  // selection id leak between two difficulty panes of one instrument.
  addNote(
    doc.parsedChart.trackData[1],
    {tick: 480, type: noteTypes.green},
    guitarSchema,
  );
  addNote(
    doc.parsedChart.trackData[3],
    {tick: 480, type: noteTypes.green},
    guitarSchema,
  );

  return doc;
}



const fakeAudioManager = {} as AudioManager;

function noteHit(noteId: string): HitResult {
  return {
    type: 'note',
    noteId,
    tick: 0,
    lane: 0,
    note: {},
  } as unknown as HitResult;
}

/** Dispatches the test's setup actions, then renders `HighwayEditor`. */
function Harness({
  chartDoc,
  visible,
  activeTool = 'erase',
}: {
  chartDoc: ChartDocument;
  visible: string[];
  activeTool?: 'cursor' | 'erase' | 'place';
}) {
  const {dispatch} = useChartEditorContext();

  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc});
    dispatch({type: 'SET_VISIBLE_TRACKS', tracks: new Set(visible)});
    dispatch({type: 'SET_ACTIVE_TOOL', tool: activeTool});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <HighwayEditor
      chart={chartDoc.parsedChart}
      audioManager={fakeAudioManager}
    />
  );
}

/** Exposes `state.undoEntries` as JSON text so tests can assert on the last
 *  issued command without reaching into React internals. */
function UndoStackProbe() {
  const {state} = useChartEditorContext();
  const last = state.undoEntries[state.undoEntries.length - 1]?.command;
  return (
    <pre data-testid="undo-stack-probe">
      {last ? JSON.stringify(Array.from(last.affectedTracks ?? [])) : ''}
    </pre>
  );
}

/** Exposes the note-selection ids as sorted JSON so tests can assert the
 *  exact ids a pane interaction wrote into `state.selection`. */
function SelectionProbe() {
  const {state} = useChartEditorContext();
  const ids = Array.from(state.selection.get('note') ?? []).sort();
  return <pre data-testid="selection-probe">{JSON.stringify(ids)}</pre>;
}

/** Exposes `activeScope` (the keyboard-entry / Note Inspector target). */
function ActiveScopeProbe() {
  const {state} = useChartEditorContext();
  const {activeScope} = state;
  return (
    <pre data-testid="active-scope-probe">
      {activeScope.kind === 'track'
        ? `${activeScope.track.instrument}:${activeScope.track.difficulty}`
        : activeScope.kind}
    </pre>
  );
}

/** Mounts the editor keyboard bindings for the shortcut tests. */
function KeyboardHarness() {
  useEditorKeyboard();
  return null;
}

function renderHarness(props: {
  chartDoc: ChartDocument;
  visible: string[];
  activeTool?: 'cursor' | 'erase' | 'place';
}) {
  return render(
    <AudioServiceProvider>
      <ChartEditorProvider>
        <Harness {...props} />
        <UndoStackProbe />
        <SelectionProbe />
        <ActiveScopeProbe />
        <KeyboardHarness />
      </ChartEditorProvider>
    </AudioServiceProvider>,
  );
}

/**
 * jsdom has no layout, so every element reports 0 for `offsetWidth` /
 * `offsetHeight` — which is exactly the unmeasured case `computeStageLayout`
 * falls back on (cap = `MAX_HIGHWAYS`). Stubbing the prototype getters is the
 * only way to drive the width-derived lane cap from jsdom; the default of 0
 * keeps every other test on the fallback path.
 */
const simulatedCanvas = {width: 0, height: 0};

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => simulatedCanvas.width,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => simulatedCanvas.height,
  });
});

beforeEach(() => {
  mockStageHighways.length = 0;
  mockStages.length = 0;
  simulatedCanvas.width = 0;
  simulatedCanvas.height = 0;
  for (const key of Object.keys(mockTrackHits)) delete mockTrackHits[key];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HighwayEditor multi-pane (plan 0074 Phase 3)', () => {
  it('renders a safe empty state when no tracks are visible', () => {
    renderHarness({chartDoc: makeMultiInstrumentDoc(), visible: []});
    expect(screen.getByText(/no tracks shown/i)).toBeInTheDocument();
  });

  it('renders one pane per visible track, each labeled with instrument · difficulty', async () => {
    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert'],
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('highway-lane-drums:expert'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('highway-lane-guitar:expert'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Drums · Expert')).toBeInTheDocument();
    expect(screen.getByText('Guitar · Expert')).toBeInTheDocument();
  });

  it('centers each pane label along the bottom of its own pane', async () => {
    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert'],
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-drums:expert'),
      ).toBeInTheDocument(),
    );

    // The strikeline projects near the bottom of a pane but not at its edge
    // (see `cameraFit`), so the label lives under it — one per pane,
    // horizontally centered, never over the note-hit area.
    for (const [laneId, text] of [
      ['drums:expert', 'Drums · Expert'],
      ['guitar:expert', 'Guitar · Expert'],
    ] as const) {
      const pane = screen.getByTestId(`highway-lane-${laneId}`);
      const label = screen.getByText(text);
      expect(pane).toContainElement(label);
      expect(label.className).toContain('bottom-2');
      expect(label.className).toContain('left-1/2');
      expect(label.className).toContain('-translate-x-1/2');
      expect(label.className).not.toContain('top-2');
    }
  });

  // This case survives in jsdom only because `computeStageLayout` reports
  // `measured: false` at a canvas width of 0 and hands back `MAX_HIGHWAYS`
  // instead of a width-derived cap. Without that rule every layout here would
  // collapse to a single lane. The cap itself is exercised against simulated
  // widths in the "width-derived lane cap" block below.
  it('renders four visible tracks with no overflow chip (the X/H/M/E route model)', async () => {
    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert', 'bass:expert', 'guitar:hard'],
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-drums:expert'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('highway-lane-guitar:expert'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('highway-lane-bass:expert')).toBeInTheDocument();
    expect(screen.getByTestId('highway-lane-guitar:hard')).toBeInTheDocument();
    expect(
      screen.queryByTestId('highway-overflow-indicator'),
    ).not.toBeInTheDocument();
  });

  it('caps panes at the width-derived maximum and shows a "+N more" overflow indicator beyond that', async () => {
    // 900 CSS px holds four 200 px lanes plus their hairlines, not five.
    simulatedCanvas.width = 900;
    simulatedCanvas.height = 400;
    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: [
        'drums:expert',
        'guitar:expert',
        'bass:expert',
        'guitar:hard',
        'guitar:medium',
      ],
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-drums:expert'),
      ).toBeInTheDocument(),
    );
    // First four visible tracks get panes; the fifth does not.
    expect(
      screen.getByTestId('highway-lane-guitar:expert'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('highway-lane-bass:expert')).toBeInTheDocument();
    expect(screen.getByTestId('highway-lane-guitar:hard')).toBeInTheDocument();
    expect(
      screen.queryByTestId('highway-lane-guitar:medium'),
    ).not.toBeInTheDocument();

    // The harness renders a single-track piano roll, which does NOT show the
    // tracks that missed a pane — the chip must not claim otherwise.
    expect(screen.getByTestId('highway-overflow-indicator')).toHaveTextContent(
      '+1 more hidden',
    );
  });

  it('points the overflow chip at the piano roll when it stacks every track', async () => {
    simulatedCanvas.width = 900;
    simulatedCanvas.height = 400;
    const doc = makeMultiInstrumentDoc();

    function StackedHarness() {
      const {dispatch} = useChartEditorContext();
      useEffect(() => {
        dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
        dispatch({
          type: 'SET_VISIBLE_TRACKS',
          tracks: new Set([
            'drums:expert',
            'guitar:expert',
            'bass:expert',
            'guitar:hard',
            'guitar:medium',
          ]),
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <HighwayEditor
          chart={doc.parsedChart}
          audioManager={fakeAudioManager}
          stackedPianoRoll
        />
      );
    }

    render(
      <AudioServiceProvider>
        <ChartEditorProvider>
          <StackedHarness />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    expect(
      await screen.findByTestId('highway-overflow-indicator'),
    ).toHaveTextContent('+1 more shown in piano roll');
  });

  it('drops visible ids for tracks the doc no longer contains', async () => {
    const doc = makeMultiInstrumentDoc();
    doc.parsedChart.trackData = doc.parsedChart.trackData.filter(
      track => track.instrument !== 'bass',
    );

    renderHarness({
      chartDoc: doc,
      visible: ['drums:expert', 'bass:expert'],
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-drums:expert'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('highway-lane-bass:expert'),
    ).not.toBeInTheDocument();
  });

  it("pointer interaction in each pane targets that pane's own track", async () => {
    mockTrackHits['drums:expert'] = noteHit('0:kick');
    mockTrackHits['guitar:expert'] = noteHit('0:green');

    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert'],
      activeTool: 'erase',
    });

    const drumsPane = await screen.findByTestId('highway-lane-drums:expert');
    const guitarPane = await screen.findByTestId('highway-lane-guitar:expert');
    // The InteractionManager only resolves after the fake highway's
    // getInteractionManager() promise settles — wait for that microtask.
    await waitFor(() =>
      expect(mockStageHighways.length).toBeGreaterThanOrEqual(2),
    );

    const drumsInteraction = drumsPane.querySelector(
      'div.absolute.inset-0',
    ) as HTMLElement;
    const guitarInteraction = guitarPane.querySelector(
      'div.absolute.inset-0',
    ) as HTMLElement;

    act(() => {
      fireEvent.mouseDown(drumsInteraction, {clientX: 10, clientY: 10});
    });

    await waitFor(() => {
      const probe = screen.getByTestId('undo-stack-probe');
      expect(probe.textContent).toBe(JSON.stringify(['drums:expert']));
    });

    act(() => {
      fireEvent.mouseDown(guitarInteraction, {clientX: 10, clientY: 10});
    });

    await waitFor(() => {
      const probe = screen.getByTestId('undo-stack-probe');
      expect(probe.textContent).toBe(JSON.stringify(['guitar:expert']));
    });
  });

  it('stores note selections track-qualified so they cannot leak into another pane', async () => {
    // guitar Expert and bass Expert both have green at tick 0: the same
    // LOCAL note id ("0:green") in two panes.
    mockTrackHits['guitar:expert'] = noteHit('0:green');
    mockTrackHits['bass:expert'] = noteHit('0:green');

    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['guitar:expert', 'bass:expert'],
      activeTool: 'cursor',
    });

    const guitarPane = await screen.findByTestId('highway-lane-guitar:expert');
    await waitFor(() =>
      expect(mockStageHighways.length).toBeGreaterThanOrEqual(2),
    );

    act(() => {
      fireEvent.mouseDown(
        guitarPane.querySelector('div.absolute.inset-0') as HTMLElement,
        {clientX: 10, clientY: 10},
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('selection-probe').textContent).toBe(
        JSON.stringify(['guitar:expert|0:green']),
      ),
    );

    // ...and the bass pane's highway is never told to highlight a note.
    const bassReconciler = mockStageHighways.find(
      i => i.track?.instrument === 'bass',
    )!.reconciler;
    for (const call of bassReconciler.setSelectedKeys.mock.calls) {
      expect(Array.from(call[0] as Set<string>)).toEqual([]);
    }
  });

  it('retargets keyboard entry to the pane that was last moused down in', async () => {
    mockTrackHits['drums:expert'] = noteHit('0:kick');
    mockTrackHits['guitar:expert'] = noteHit('0:green');

    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert'],
      activeTool: 'cursor',
    });

    const guitarPane = await screen.findByTestId('highway-lane-guitar:expert');
    await waitFor(() =>
      expect(mockStageHighways.length).toBeGreaterThanOrEqual(2),
    );

    act(() => {
      fireEvent.mouseDown(
        guitarPane.querySelector('div.absolute.inset-0') as HTMLElement,
        {clientX: 10, clientY: 10},
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('active-scope-probe').textContent).toBe(
        'guitar:expert',
      ),
    );
  });

  it('cycles the active track with Alt+ArrowDown / Alt+ArrowUp (keyboard-only route)', async () => {
    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert', 'bass:expert'],
      activeTool: 'cursor',
    });

    // The provider's default scope (drums Expert) is the first visible id.
    await waitFor(() =>
      expect(screen.getByTestId('active-scope-probe').textContent).toBe(
        'drums:expert',
      ),
    );

    act(() => {
      fireEvent.keyDown(document, {key: 'ArrowDown', altKey: true});
    });
    await waitFor(() =>
      expect(screen.getByTestId('active-scope-probe').textContent).toBe(
        'guitar:expert',
      ),
    );

    act(() => {
      fireEvent.keyDown(document, {key: 'ArrowUp', altKey: true});
    });
    await waitFor(() =>
      expect(screen.getByTestId('active-scope-probe').textContent).toBe(
        'drums:expert',
      ),
    );
  });

  it('renders a single vocals pane (no track panes) on a vocals scope', async () => {
    const doc = makeMultiInstrumentDoc();

    function VocalsHarness() {
      const {dispatch} = useChartEditorContext();
      useEffect(() => {
        dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <HighwayEditor
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

    // `SET_CHART_DOC` seeds visibleTrackKeys with the preferred track, but a
    // vocals scope renders its own pane instead of any notes pane.
    expect(
      await screen.findByTestId('highway-lane-vocals:vocals'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('highway-lane-guitar:expert'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Guitar · Expert')).not.toBeInTheDocument();
    // No notes track is resolved for the pane's highway.
    await waitFor(() =>
      expect(mockStageHighways.length).toBeGreaterThanOrEqual(1),
    );
    expect(mockStageHighways[0].track).toBeNull();
  });

  it.each([
    ['PREVIEW', PREVIEW_CAPABILITIES],
    ['TEMPO', TEMPO_CAPABILITIES],
  ])(
    'renders the configured activeScope track on %s (no Chart Matrix to change the visible set)',
    async (_name, capabilities: EditorCapabilities) => {
      const doc = makeMultiInstrumentDoc();

      function ScopedHarness() {
        const {dispatch} = useChartEditorContext();
        useEffect(() => {
          // Exactly what `/preview` and `/tempo` dispatch: the doc, and
          // nothing else. `SET_CHART_DOC` seeds visibleTrackKeys with the
          // preferred track (guitar Expert here), which these pages have no
          // way to change and whose piano roll ignores.
          dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return (
          <HighwayEditor
            chart={doc.parsedChart}
            audioManager={fakeAudioManager}
          />
        );
      }

      render(
        <AudioServiceProvider>
          <ChartEditorProvider
            capabilities={capabilities}
            activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
            <ScopedHarness />
            <ActiveScopeProbe />
          </ChartEditorProvider>
        </AudioServiceProvider>,
      );

      expect(
        await screen.findByTestId('highway-lane-drums:expert'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('highway-lane-guitar:expert'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('active-scope-probe').textContent).toBe(
        'drums:expert',
      );
    },
  );

  it("removes the highway's root and disposes its reconciler without touching the stage renderer", async () => {
    mockTrackHits['drums:expert'] = noteHit('0:kick');
    const doc = makeMultiInstrumentDoc();

    function ToggleHarness({visible}: {visible: string[]}) {
      const {dispatch} = useChartEditorContext();
      useEffect(() => {
        dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
        dispatch({type: 'SET_VISIBLE_TRACKS', tracks: new Set(visible)});
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [visible.join(',')]);
      return (
        <HighwayEditor
          chart={doc.parsedChart}
          audioManager={fakeAudioManager}
        />
      );
    }

    const {rerender} = render(
      <AudioServiceProvider>
        <ChartEditorProvider>
          <ToggleHarness visible={['drums:expert', 'guitar:expert']} />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    await waitFor(() =>
      expect(mockStageHighways.length).toBeGreaterThanOrEqual(2),
    );
    const drumsHighway = mockStageHighways.find(
      i => i.track?.instrument === 'drums',
    )!;
    const stage = mockStages[mockStages.length - 1];
    expect(drumsHighway.reconciler.dispose).not.toHaveBeenCalled();

    // Toggle the drums track off — re-render with only guitar visible.
    rerender(
      <AudioServiceProvider>
        <ChartEditorProvider>
          <ToggleHarness visible={['guitar:expert']} />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    // The drums highway is unmounted from the stage and its own scene objects
    // are disposed; the stage's renderer, canvas, and surviving highways are
    // untouched. The stage's own teardown idempotency is covered against the
    // real implementation in `lib/preview/highway/__tests__/teardown.test.ts`.
    await waitFor(() =>
      expect(stage.removeHighway).toHaveBeenCalledWith('drums:expert'),
    );
    expect(drumsHighway.reconciler.dispose).toHaveBeenCalledTimes(1);
    expect(stage.destroy).not.toHaveBeenCalled();
    // One stage for the whole session: toggling a track never builds a second
    // renderer, which is the whole point of mounting highways into a live one.
    expect(mockStages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Width-derived lane cap (plan 0075 Phase 4). How many lanes fit comes from
// `computeStageLayout` reading the measured canvas width, not from a constant.
// ---------------------------------------------------------------------------

describe('width-derived lane cap (plan 0075 Phase 4)', () => {
  /** Every live `ResizeObserver` callback, so a test can drive a resize. */
  const resizeCallbacks: (() => void)[] = [];
  let previousResizeObserver: unknown;

  beforeAll(() => {
    previousResizeObserver = (globalThis as {ResizeObserver?: unknown})
      .ResizeObserver;
    (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterAll(() => {
    (globalThis as {ResizeObserver?: unknown}).ResizeObserver =
      previousResizeObserver;
  });

  beforeEach(() => {
    resizeCallbacks.length = 0;
  });

  const fiveTracks = [
    'drums:expert',
    'guitar:expert',
    'bass:expert',
    'guitar:hard',
    'guitar:medium',
  ];

  it('fits fewer lanes on a narrow canvas', async () => {
    // 500 px holds two 200 px lanes plus a hairline, not three.
    simulatedCanvas.width = 500;
    simulatedCanvas.height = 400;
    renderHarness({chartDoc: makeMultiInstrumentDoc(), visible: fiveTracks});

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-drums:expert'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('highway-lane-guitar:expert'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('highway-lane-bass:expert'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('highway-overflow-indicator')).toHaveTextContent(
      '+3 more hidden',
    );
  });

  it('falls back to MAX_HIGHWAYS when the canvas width is unmeasured', async () => {
    // The default jsdom state: no layout, so offsetWidth is 0. Every routing
    // test in this file depends on this rule holding.
    renderHarness({chartDoc: makeMultiInstrumentDoc(), visible: fiveTracks});

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-drums:expert'),
      ).toBeInTheDocument(),
    );
    for (const id of fiveTracks) {
      expect(screen.getByTestId(`highway-lane-${id}`)).toBeInTheDocument();
    }
    expect(
      screen.queryByTestId('highway-overflow-indicator'),
    ).not.toBeInTheDocument();
  });

  it('rebuilds the stage and re-adds every visible lane after a lost context', async () => {
    // One context now backs the whole strip, so losing it blanks every lane
    // at once: the editor answers by building a replacement stage.
    simulatedCanvas.width = 900;
    simulatedCanvas.height = 400;
    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert'],
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-guitar:expert'),
      ).toBeInTheDocument(),
    );
    expect(mockStages).toHaveLength(1);
    const lost = mockStages[0];

    act(() => {
      lost.loseContext();
    });

    await waitFor(() => expect(mockStages).toHaveLength(2));
    const replacement = mockStages[1];
    expect(lost.destroy).toHaveBeenCalledTimes(1);

    // The current visible set comes back on the new context, and it renders.
    await waitFor(() =>
      expect(replacement.addHighway).toHaveBeenCalledTimes(2),
    );
    expect(replacement.addHighway.mock.calls.map(call => call[0])).toEqual([
      'drums:expert',
      'guitar:expert',
    ]);
    expect(replacement.startRender).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('highway-lane-guitar:expert'),
    ).toBeInTheDocument();
  });

  it('re-lays out the lanes on resize without rebuilding the stage', async () => {
    simulatedCanvas.width = 500;
    simulatedCanvas.height = 400;
    renderHarness({chartDoc: makeMultiInstrumentDoc(), visible: fiveTracks});

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-guitar:expert'),
      ).toBeInTheDocument(),
    );
    const stage = mockStages[mockStages.length - 1];
    expect(
      screen.queryByTestId('highway-lane-bass:expert'),
    ).not.toBeInTheDocument();

    // Widen the canvas: two more lanes now fit.
    simulatedCanvas.width = 900;
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-lane-guitar:hard'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId('highway-lane-bass:expert')).toBeInTheDocument();
    expect(screen.getByTestId('highway-overflow-indicator')).toHaveTextContent(
      '+1 more hidden',
    );

    // The two lanes that were already up are never remounted, and the wider
    // layout reaches the stage through `setLayout` -- no new stage, no
    // teardown, no second renderer.
    expect(stage.removeHighway).not.toHaveBeenCalled();
    expect(stage.destroy).not.toHaveBeenCalled();
    expect(mockStages).toHaveLength(1);

    const [lastLayout, lastOrder] =
      stage.setLayout.mock.calls[stage.setLayout.mock.calls.length - 1];
    expect(lastLayout.canvas).toEqual({width: 900, height: 400});
    expect(lastLayout.measured).toBe(true);
    expect(lastLayout.maxHighways).toBe(4);
    expect(lastLayout.highways).toHaveLength(4);
    expect(lastOrder).toEqual([
      'drums:expert',
      'guitar:expert',
      'bass:expert',
      'guitar:hard',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Piano-roll producer / consumer, on surfaces whose piano roll is NOT
// stacked: the same track-qualified id convention has to hold there too,
// in both directions.
// ---------------------------------------------------------------------------

describe('single-track piano roll ↔ highway selection (plan 0074 Phase 3)', () => {
  /** Every `fillStyle` the piano roll's 2D context was set to since the last
   *  `paintedFills.length = 0` — the only way to observe what the canvas
   *  actually painted. */
  const paintedFills: string[] = [];

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
      } as Record<string | symbol, unknown>,
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          return () => {};
        },
        set(_target, prop, value) {
          if (prop === 'fillStyle' && typeof value === 'string') {
            paintedFills.push(value);
          }
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

  /** The white halo `drawNotes` paints behind a SELECTED note head — the
   *  visible outcome of "the piano roll shows this note as selected". */
  const SELECTION_HALO = 'rgba(255,255,255,0.92)';

  function stubAudioManager(): AudioManager {
    return {
      chartTime: 0,
      isPlaying: false,
      duration: 10,
      chartDelay: 0,
      ready: Promise.resolve(),
      trackNames: ['song'],
      getTrackPcm: () => null,
      seekToChartTime: () => {},
      playChartTime: () => {},
    } as unknown as AudioManager;
  }

  function firePointer(
    canvas: HTMLCanvasElement,
    type: string,
    x: number,
    y: number,
  ) {
    const evt = new MouseEvent(type, {bubbles: true, cancelable: true});
    Object.defineProperty(evt, 'offsetX', {value: x, configurable: true});
    Object.defineProperty(evt, 'offsetY', {value: y, configurable: true});
    Object.defineProperty(evt, 'pointerId', {value: 1, configurable: true});
    canvas.dispatchEvent(evt);
  }

  /**
   * Click every candidate note-lane position until one of them selects a
   * note, and return the resulting selection. The panel's px-per-ms scale
   * depends on beat-grid end padding this test has no reason to know, so the
   * note is located by probing rather than by an assumed constant.
   */
  function clickNoteInPianoRoll(
    canvas: HTMLCanvasElement,
    expectedId: string,
  ): void {
    for (let y = 52; y < 158; y += 4) {
      for (let x = 0; x <= 160; x += 6) {
        act(() => {
          firePointer(canvas, 'pointerdown', x, y);
          firePointer(canvas, 'pointerup', x, y);
        });
        if (
          screen.getByTestId('selection-probe').textContent ===
          JSON.stringify([expectedId])
        ) {
          return;
        }
      }
    }
    throw new Error(`clickNoteInPianoRoll: never selected ${expectedId}`);
  }

  /** Every reconciler belonging to a highway that rendered `track` — a pane
   *  may mount more than one highway over its lifetime. */
  function reconcilersFor(instrument: string, difficulty: string) {
    return mockStageHighways
      .filter(
        i =>
          i.track?.instrument === instrument &&
          i.track.difficulty === difficulty,
      )
      .map(i => i.reconciler);
  }

  function renderSurface({
    doc,
    visible,
    scope,
    capabilities,
  }: {
    doc: ChartDocument;
    visible: string[];
    scope: EditorScope;
    capabilities?: EditorCapabilities;
  }) {
    function Surface() {
      const {dispatch} = useChartEditorContext();
      useEffect(() => {
        dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
        dispatch({type: 'SET_VISIBLE_TRACKS', tracks: new Set(visible)});
        dispatch({type: 'SET_ACTIVE_TOOL', tool: 'cursor'});
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <>
          <HighwayEditor
            chart={doc.parsedChart}
            audioManager={fakeAudioManager}
          />
          <PianoRollTimeline
            audioManager={stubAudioManager()}
            durationSeconds={10}
            audioChannels={2}
          />
        </>
      );
    }

    return render(
      <AudioServiceProvider>
        <ChartEditorProvider
          {...(capabilities ? {capabilities} : {})}
          activeScope={scope}>
          <Surface />
          <SelectionProbe />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );
  }

  beforeEach(() => {
    paintedFills.length = 0;
  });

  it('renders a highway note selection in the single-track piano roll', async () => {
    // One drums pane, a piano roll that is not stacked.
    mockTrackHits['drums:expert'] = noteHit('480:redDrum');
    const doc = makeMultiInstrumentDoc();

    const {container} = renderSurface({
      doc,
      visible: ['drums:expert'],
      scope: DEFAULT_DRUMS_EXPERT_SCOPE,
    });

    const pane = await screen.findByTestId('highway-lane-drums:expert');
    await waitFor(() =>
      expect(mockStageHighways.length).toBeGreaterThanOrEqual(1),
    );
    // Nothing is selected yet, so nothing has painted a selection halo.
    expect(paintedFills).not.toContain(SELECTION_HALO);

    act(() => {
      fireEvent.mouseDown(
        pane.querySelector('div.absolute.inset-0') as HTMLElement,
        {clientX: 10, clientY: 10},
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('selection-probe').textContent).toBe(
        JSON.stringify(['drums:expert|480:redDrum']),
      ),
    );

    // ...and the piano roll paints that note as selected.
    expect(container.querySelector('canvas')).not.toBeNull();
    await waitFor(() => expect(paintedFills).toContain(SELECTION_HALO));
  });

  it('pushes a single-track piano-roll selection to the highway renderer', async () => {
    const doc = makeMultiInstrumentDoc();
    const {container} = renderSurface({
      doc,
      visible: ['drums:expert'],
      scope: DEFAULT_DRUMS_EXPERT_SCOPE,
    });

    await screen.findByTestId('highway-lane-drums:expert');
    await waitFor(() =>
      expect(mockStageHighways.length).toBeGreaterThanOrEqual(1),
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    clickNoteInPianoRoll(canvas, 'drums:expert|480:redDrum');

    // The drums pane's renderer is told to highlight that note, under the
    // LOCAL id its scene knows it by.
    await waitFor(() => {
      const pushed = reconcilersFor('drums', 'expert').flatMap(r =>
        r.setSelectedKeys.mock.calls.map(call =>
          Array.from(call[0] as Set<string>).join(','),
        ),
      );
      expect(pushed).toContain('note:480:redDrum');
    });
  });

  it('does not leak a piano-roll selection into another difficulty pane of the same instrument', async () => {
    // Guitar Expert and Hard both toggled visible: two panes, and
    // "480:green" exists in both tracks.
    const doc = makeMultiInstrumentDoc();
    const {container} = renderSurface({
      doc,
      visible: ['guitar:expert', 'guitar:hard'],
      scope: DEFAULT_GUITAR_EXPERT_SCOPE,
    });

    await screen.findByTestId('highway-lane-guitar:expert');
    await screen.findByTestId('highway-lane-guitar:hard');
    await waitFor(() =>
      expect(mockStageHighways.length).toBeGreaterThanOrEqual(2),
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    clickNoteInPianoRoll(canvas, 'guitar:expert|480:green');

    // The Expert pane highlights it; the Hard pane never highlights its own
    // colliding "480:green".
    await waitFor(() => {
      const pushed = reconcilersFor('guitar', 'expert').flatMap(r =>
        r.setSelectedKeys.mock.calls.map(call =>
          Array.from(call[0] as Set<string>).join(','),
        ),
      );
      expect(pushed).toContain('note:480:green');
    });
    const hardReconcilers = reconcilersFor('guitar', 'hard');
    expect(hardReconcilers.length).toBeGreaterThanOrEqual(1);
    for (const reconciler of hardReconcilers) {
      for (const call of reconciler.setSelectedKeys.mock.calls) {
        expect(Array.from(call[0] as Set<string>)).toEqual([]);
      }
    }
  });
});
