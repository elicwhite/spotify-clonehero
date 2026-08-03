/**
 * @jest-environment jsdom
 */
/**
 * Multi-pane highway (plan 0074 Phase 3, Suite 4): `HighwayEditor` renders
 * one pane per visible track, caps at 3 with an overflow chip, and each
 * pane's interaction hooks target that pane's own track — never the
 * globally-last-set `activeScope` of some other pane.
 *
 * `@/lib/preview/highway`'s `setupRenderer` is mocked wholesale: real
 * `HighwayPreview` instances would need a WebGL context jsdom doesn't
 * provide. The fake renderer resolves `getInteractionManager()` to a stub
 * whose `hitTest` is configured per-track (via `mockTrackHits`), so pointer
 * events drive the REAL `useHighwayMouseInteraction` / tool-registry /
 * command stack end to end — only the THREE.js boundary is faked.
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
  DRUM_EDIT_CAPABILITIES,
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
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {HitResult} from '@/lib/preview/highway';

// ---------------------------------------------------------------------------
// setupRenderer mock — see file header.
// ---------------------------------------------------------------------------

/** hitTest result each fake renderer's InteractionManager returns, keyed by
 *  `"${instrument}:${difficulty}"`. Set per-test before rendering. */
const mockTrackHits: Record<string, HitResult> = {};

/** Every fake renderer created, in creation order — lets tests assert
 *  `destroy` was called on the right instance without depending on internal
 *  HighwayPreview refs. */
const mockRendererInstances: Array<{
  track: {instrument: string; difficulty: string} | null;
  destroy: jest.Mock;
  reconciler: {
    setElements: jest.Mock;
    setHoveredKey: jest.Mock;
    setSelectedKeys: jest.Mock;
    dispose: jest.Mock;
  };
}> = [];

function mockMakeRenderer() {
  const interactionManager = {
    hitTest: jest.fn(() => null as HitResult),
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
  const noteRenderer = {dispose: jest.fn()};
  const destroy = jest.fn(async () => {});
  const instance = {
    track: null as {instrument: string; difficulty: string} | null,
    destroy,
    reconciler,
  };
  mockRendererInstances.push(instance);

  return {
    prepTrack: jest.fn(
      async (track: {instrument: string; difficulty: string} | null) => {
        instance.track = track;
        if (track) {
          const key = `${track.instrument}:${track.difficulty}`;
          interactionManager.hitTest.mockReturnValue(
            mockTrackHits[key] ?? null,
          );
        }
      },
    ),
    startRender: jest.fn(async () => {}),
    destroy,
    getCamera: jest.fn(),
    getHighwaySpeed: jest.fn(() => 1.5),
    setOverlayState: jest.fn(),
    setTimingData: jest.fn(async () => {}),
    getInteractionManager: jest.fn(async () => interactionManager),
    getReconciler: jest.fn(async () => reconciler),
    getNoteRenderer: jest.fn(async () => noteRenderer),
    setWaveformData: jest.fn(async () => {}),
    setGridData: jest.fn(async () => {}),
    setLyricsData: jest.fn(async () => {}),
    setHighwayMode: jest.fn(),
    getHighwayMode: jest.fn(() => 'classic' as const),
  };
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
    setupRenderer: jest.fn(() => mockMakeRenderer()),
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
  // Fourth charted track: lets a test make 4 tracks visible and exercise
  // MAX_HIGHWAY_PANES + the overflow chip.
  parsed.trackData.push(emptyTrackData('guitar', 'hard'));
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

function makeMetadata(): ChartResponseEncore {
  return {song_length: 60_000} as ChartResponseEncore;
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
      metadata={makeMetadata()}
      chart={chartDoc.parsedChart}
      audioManager={fakeAudioManager}
    />
  );
}

/** Exposes `state.undoStack` as JSON text so tests can assert on the last
 *  issued command without reaching into React internals. */
function UndoStackProbe() {
  const {state} = useChartEditorContext();
  const last = state.undoStack[state.undoStack.length - 1];
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

beforeEach(() => {
  mockRendererInstances.length = 0;
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
        screen.getByTestId('highway-pane-drums:expert'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('highway-pane-guitar:expert'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Drums · Expert')).toBeInTheDocument();
    expect(screen.getByText('Guitar · Expert')).toBeInTheDocument();
  });

  it('renders every visible track up to the cap with no overflow chip', async () => {
    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert', 'bass:expert'],
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('highway-pane-drums:expert'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('highway-pane-guitar:expert'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('highway-pane-bass:expert')).toBeInTheDocument();
    expect(
      screen.queryByTestId('highway-overflow-indicator'),
    ).not.toBeInTheDocument();
  });

  it('caps panes at 3 and shows a "+N more" overflow indicator beyond that', async () => {
    renderHarness({
      chartDoc: makeMultiInstrumentDoc(),
      visible: ['drums:expert', 'guitar:expert', 'bass:expert', 'guitar:hard'],
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('highway-pane-drums:expert'),
      ).toBeInTheDocument(),
    );
    // First three visible tracks get panes; the fourth does not.
    expect(
      screen.getByTestId('highway-pane-guitar:expert'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('highway-pane-bass:expert')).toBeInTheDocument();
    expect(
      screen.queryByTestId('highway-pane-guitar:hard'),
    ).not.toBeInTheDocument();

    // The harness renders a single-track piano roll, which does NOT show the
    // tracks that missed a pane — the chip must not claim otherwise.
    expect(screen.getByTestId('highway-overflow-indicator')).toHaveTextContent(
      '+1 more hidden',
    );
  });

  it('points the overflow chip at the piano roll when it stacks every track', async () => {
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
          ]),
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <HighwayEditor
          metadata={makeMetadata()}
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
        screen.getByTestId('highway-pane-drums:expert'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('highway-pane-bass:expert'),
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

    const drumsPane = await screen.findByTestId('highway-pane-drums:expert');
    const guitarPane = await screen.findByTestId('highway-pane-guitar:expert');
    // The InteractionManager only resolves after the fake renderer's
    // getInteractionManager() promise settles — wait for that microtask.
    await waitFor(() =>
      expect(mockRendererInstances.length).toBeGreaterThanOrEqual(2),
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

    const guitarPane = await screen.findByTestId('highway-pane-guitar:expert');
    await waitFor(() =>
      expect(mockRendererInstances.length).toBeGreaterThanOrEqual(2),
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

    // ...and the bass pane's renderer is never told to highlight a note.
    const bassReconciler = mockRendererInstances.find(
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

    const guitarPane = await screen.findByTestId('highway-pane-guitar:expert');
    await waitFor(() =>
      expect(mockRendererInstances.length).toBeGreaterThanOrEqual(2),
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
          metadata={makeMetadata()}
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
      await screen.findByTestId('highway-pane-vocals:vocals'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('highway-pane-guitar:expert'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Guitar · Expert')).not.toBeInTheDocument();
    // No notes track is resolved for the pane's renderer.
    await waitFor(() =>
      expect(mockRendererInstances.length).toBeGreaterThanOrEqual(1),
    );
    expect(mockRendererInstances[0].track).toBeNull();
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
            metadata={makeMetadata()}
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
        await screen.findByTestId('highway-pane-drums:expert'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('highway-pane-guitar:expert'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('active-scope-probe').textContent).toBe(
        'drums:expert',
      );
    },
  );

  it("disposes a pane's renderer deterministically when its track is toggled off", async () => {
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
          metadata={makeMetadata()}
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
      expect(mockRendererInstances.length).toBeGreaterThanOrEqual(2),
    );
    const drumsInstance = mockRendererInstances.find(
      i => i.track?.instrument === 'drums',
    )!;
    expect(drumsInstance.destroy).not.toHaveBeenCalled();

    // Toggle the drums track off — re-render with only guitar visible.
    rerender(
      <AudioServiceProvider>
        <ChartEditorProvider>
          <ToggleHarness visible={['guitar:expert']} />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    // Exactly once, and synchronously with the unmount — the renderer's own
    // idempotency under a repeated destroy() is covered against the real
    // implementation in `lib/preview/highway/__tests__/teardown.test.ts`.
    await waitFor(() => expect(drumsInstance.destroy).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// Piano-roll producer / consumer, on surfaces whose piano roll is NOT stacked
// (`/drum-edit`, `/guitar-edit`, `/bass-edit`): the same track-qualified id
// convention has to hold there too, in both directions.
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

  /** Every reconciler belonging to a pane that rendered `track` — a pane may
   *  build more than one renderer over its lifetime. */
  function reconcilersFor(instrument: string, difficulty: string) {
    return mockRendererInstances
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
            metadata={makeMetadata()}
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
    // `/drum-edit`: one drums pane, a piano roll that is not stacked.
    mockTrackHits['drums:expert'] = noteHit('480:redDrum');
    const doc = makeMultiInstrumentDoc();

    const {container} = renderSurface({
      doc,
      visible: ['drums:expert'],
      scope: DEFAULT_DRUMS_EXPERT_SCOPE,
    });

    const pane = await screen.findByTestId('highway-pane-drums:expert');
    await waitFor(() =>
      expect(mockRendererInstances.length).toBeGreaterThanOrEqual(1),
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

    await screen.findByTestId('highway-pane-drums:expert');
    await waitFor(() =>
      expect(mockRendererInstances.length).toBeGreaterThanOrEqual(1),
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
    // `/guitar-edit` with the matrix pinned to guitar and BOTH Expert and
    // Hard toggled on: two panes, and "480:green" exists in both tracks.
    const doc = makeMultiInstrumentDoc();
    const {container} = renderSurface({
      doc,
      visible: ['guitar:expert', 'guitar:hard'],
      scope: DEFAULT_GUITAR_EXPERT_SCOPE,
      capabilities: {...DRUM_EDIT_CAPABILITIES, showChartMatrix: 'guitar'},
    });

    await screen.findByTestId('highway-pane-guitar:expert');
    await screen.findByTestId('highway-pane-guitar:hard');
    await waitFor(() =>
      expect(mockRendererInstances.length).toBeGreaterThanOrEqual(2),
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
