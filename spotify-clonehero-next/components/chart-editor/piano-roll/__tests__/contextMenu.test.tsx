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
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
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
  parsed.timeSignatures[0] = {
    ...parsed.timeSignatures[0],
    numerator: 1,
    denominator: 4,
  };
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  const drums = doc.parsedChart.trackData[0];
  addDrumNote(drums, {tick: 0, type: noteTypes.kick});
  // Reach the end of the 10s view (tick 9600 @120 BPM = 10000 ms) so every
  // beat the pointer can land on is in-span for the downbeat-flag derivation.
  addDrumNote(drums, {tick: 9600, type: noteTypes.greenDrum});
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
    pause: () => {},
    getCurrentTempo: () => 1,
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

/** Marks every one of `trackIds` (`"${instrument}:${difficulty}"`) visible
 *  in the Chart Matrix once the doc has landed — the piano roll's stacked
 *  row list only shows what's visible there (item 1), so a test that wants
 *  more than one stacked row has to opt every track in explicitly. */
function SeedVisibleTracks({trackIds}: {trackIds: string[]}) {
  const {state, dispatch} = useChartEditorContext();
  useEffect(() => {
    if (!state.chartDoc) return;
    dispatch({type: 'SET_VISIBLE_TRACKS', tracks: new Set(trackIds)});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chartDoc, dispatch]);
  return null;
}

/** Latest editor state + dispatch, published by {@link Probe} so a test can
 *  seed transport state (the A/B loop) and read the result of a menu item. */
let latest: {
  state: ReturnType<typeof useChartEditorContext>['state'];
  dispatch: ReturnType<typeof useChartEditorContext>['dispatch'];
} | null = null;

function Probe() {
  const {state, dispatch} = useChartEditorContext();
  // Published in an effect, not during render: the rule the linter enforces
  // (no side effects in render) applies to test helpers too, and every read
  // below happens after React has committed.
  useEffect(() => {
    latest = {state, dispatch};
  }, [state, dispatch]);
  return null;
}

/** Ticks of every note group on the fixture's expert drum track. */
function drumNoteTicks(): number[] {
  const track = latest?.state.chartDoc?.parsedChart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  return (track?.noteEventGroups ?? []).map(group => group[0].tick);
}

function drumNoteCount(): number {
  return drumNoteTicks().length;
}

async function mountPanel(make: () => ChartDocument = makeFixtureDoc) {
  latest = null;
  const {container} = render(
    <ChartEditorProvider>
      <SeedDoc make={make} />
      <Probe />
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

/** Two expert-difficulty drum-ish tracks, enough for the stacked layout's
 *  `rows.length > 1` gate. */
function makeTwoTrackDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  parsed.trackData.push(emptyTrackData('drums', 'hard'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  addDrumNote(doc.parsedChart.trackData[1], {tick: 0, type: noteTypes.kick});
  return doc;
}

/** Mounts the panel in the stacked (per-track rows) layout and returns the
 *  scrolling rows canvas — the surface whose pointer y is row-relative. */
async function mountStackedPanel() {
  latest = null;
  const {container} = render(
    <ChartEditorProvider>
      <SeedDoc make={makeTwoTrackDoc} />
      <SeedVisibleTracks trackIds={['drums:expert', 'drums:hard']} />
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

function fireAt(
  canvas: HTMLCanvasElement,
  type: string,
  {
    x,
    y,
    button = 0,
    ctrlKey = false,
  }: {
    x: number;
    y: number;
    button?: number;
    ctrlKey?: boolean;
  },
) {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    ctrlKey,
  });
  Object.defineProperty(evt, 'offsetX', {value: x, configurable: true});
  Object.defineProperty(evt, 'offsetY', {value: y, configurable: true});
  Object.defineProperty(evt, 'pointerId', {value: 1, configurable: true});
  canvas.dispatchEvent(evt);
}

// Tempo lane sits below the ruler (24px) and the lyrics row (22px, present
// here since `makeFixtureDoc`'s vocals part has lyrics — Round 2 §4 moved
// the lyrics row directly under the ruler), so the tempo lane now starts at
// y=46, not y=24.
const TEMPO_LANE = {x: 120, y: 52};

/** Lowest tempo-lane x that hits an authored time-signature chip's pill, or
 *  -1 when none is drawn. A pointer finds a chip exactly the way a user does:
 *  the only lane positions that hit it are the ones offering its removal. */
function findTsChipHitX(canvas: HTMLCanvasElement): number {
  for (let x = 0; x <= 780; x += 1) {
    act(() => {
      fireAt(canvas, 'contextmenu', {x, y: TEMPO_LANE.y, button: 2});
    });
    if (screen.queryByText(/Remove time signature change/)) return x;
  }
  return -1;
}

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
    expect(screen.getByText('Make this a downbeat')).toBeInTheDocument();
    expect(screen.queryByText('Mark as downbeat')).not.toBeInTheDocument();
  });

  it('disables "Make this a downbeat" once the bar line is already there', async () => {
    const canvas = await mountPanel();
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    act(() => {
      screen.getByRole('button', {name: 'Make this a downbeat'}).click();
    });
    const after = latest!.state.chartDoc!.parsedChart.timeSignatures.length;

    // Right-click a position that still snaps to the tick just marked, but
    // clear of the chip the placement drew there (the chip's pill would open
    // its own remove menu instead of the empty-lane one). The default 1/4
    // grid is a 480-tick step here, tens of px wide, so backing a few px off
    // the pill's left edge stays on the same grid tick.
    const chipHitX = findTsChipHitX(canvas);
    expect(chipHitX).toBeGreaterThan(0);

    // That position now starts a bar, so the item has nothing to place and
    // must not stack a second signature there.
    act(() => {
      fireAt(canvas, 'contextmenu', {
        x: chipHitX - 8,
        y: TEMPO_LANE.y,
        button: 2,
      });
    });
    expect(
      screen.getByRole('button', {name: 'Make this a downbeat'}),
    ).toBeDisabled();
    expect(latest!.state.chartDoc!.parsedChart.timeSignatures).toHaveLength(
      after,
    );
  });

  // The remove item appears only where the lane paints a chip: the menu and
  // the renderer read the same authored time-signature list.
  it('never offers to remove a time signature where no chip is drawn', async () => {
    const canvas = await mountPanel();
    // Sweep the whole tempo lane: the fixture has exactly one signature
    // event (the initial 4/4 at tick 0, which is not removable), so no x
    // may offer a removal.
    for (let x = 0; x <= 780; x += 10) {
      act(() => {
        fireAt(canvas, 'contextmenu', {x, y: TEMPO_LANE.y, button: 2});
      });
      expect(
        screen.queryByText(/Remove time signature change/),
      ).not.toBeInTheDocument();
    }
  });

  it('offers to remove a time signature exactly where a chip is drawn', async () => {
    const canvas = await mountPanel();
    // Place a bar line mid-bar, which writes an authored signature chip.
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    act(() => {
      screen.getByRole('button', {name: 'Make this a downbeat'}).click();
    });
    const added = latest!.state.chartDoc!.parsedChart.timeSignatures;
    expect(added.length).toBeGreaterThan(1);
    const placedTick = added[added.length - 1].tick;

    // Only a narrow band of the lane — the chip's own pill — offers it.
    const removableXs: number[] = [];
    for (let x = 0; x <= 780; x += 2) {
      act(() => {
        fireAt(canvas, 'contextmenu', {x, y: TEMPO_LANE.y, button: 2});
      });
      if (screen.queryByText(/Remove time signature change/)) {
        removableXs.push(x);
      }
    }
    expect(removableXs.length).toBeGreaterThan(0);
    expect(removableXs.length).toBeLessThan(30);

    act(() => {
      fireAt(canvas, 'contextmenu', {
        x: removableXs[0],
        y: TEMPO_LANE.y,
        button: 2,
      });
    });
    act(() => {
      screen
        .getByRole('button', {name: /Remove time signature change/})
        .click();
    });
    expect(
      latest!.state.chartDoc!.parsedChart.timeSignatures.some(
        ts => ts.tick === placedTick,
      ),
    ).toBe(false);
  });

  // The bar line lands on the editor's grid, not on the nearest quarter.
  it('places the downbeat on the current grid division', async () => {
    const canvas = await mountPanel();
    act(() => {
      latest!.dispatch({type: 'SET_GRID_DIVISION', division: 16});
    });
    const before = latest!.state.chartDoc!.parsedChart.timeSignatures.length;
    act(() => {
      fireAt(canvas, 'contextmenu', {x: 123, y: TEMPO_LANE.y, button: 2});
    });
    act(() => {
      screen.getByRole('button', {name: 'Make this a downbeat'}).click();
    });
    const signatures = latest!.state.chartDoc!.parsedChart.timeSignatures;
    expect(signatures.length).toBeGreaterThan(before);
    const placed = signatures[signatures.length - 1].tick;
    // `gridDivision` counts subdivisions per WHOLE note, so division 16 at
    // resolution 480 is a `480 * 4 / 16` = 120-tick step — finer than the
    // 480-tick quarter a beat-only placement could reach.
    const {resolution} = latest!.state.chartDoc!.parsedChart;
    const gridSize = Math.round((resolution * 4) / latest!.state.gridDivision);
    expect(gridSize).toBe(120);
    expect(placed % gridSize).toBe(0);
    expect(placed % resolution).not.toBe(0);
  });

  // Change 4: right-clicking the waveform row opens the source picker.
  it('opens the waveform-source picker on a waveform-row right-click', async () => {
    const canvas = await mountPanel();

    // Waveform row is the bottom 40px of the 200px canvas (y >= 160).
    act(() => {
      fireAt(canvas, 'contextmenu', {x: 300, y: 182, button: 2});
    });
    // The mix (a non-selected source) appears in the opened menu.
    expect(screen.getByText('Song (full mix)')).toBeInTheDocument();
    // 'Drums' is the currently-selected source, shown as the checked row.
    expect(screen.getAllByText('Drums')).toHaveLength(1);
  });

  // Note lane: ruler (24) + lyrics row (22) + tempo lane (26) puts the lanes
  // at y >= 72, and the waveform row takes the bottom 40 of the 200px canvas.
  const NOTE_LANE = {x: 300, y: 100};

  it('offers "Insert note" on a note-lane right-click and inserts on select', async () => {
    const canvas = await mountPanel();
    const before = drumNoteCount();
    act(() => {
      fireAt(canvas, 'contextmenu', {...NOTE_LANE, button: 2});
    });
    const insert = screen.getByRole('button', {name: 'Insert note'});
    const ticksBefore = new Set(drumNoteTicks());
    act(() => {
      insert.click();
    });
    expect(drumNoteCount()).toBe(before + 1);

    // The inserted tick is snapped to the active grid division, not the raw
    // tick under the pointer.
    const added = drumNoteTicks().filter(t => !ticksBefore.has(t));
    expect(added).toHaveLength(1);
    const {resolution} = latest!.state.chartDoc!.parsedChart;
    // A whole note is `resolution * 4` ticks, and `gridDivision` slices it.
    const gridSize = Math.round((resolution * 4) / latest!.state.gridDivision);
    expect(added[0] % gridSize).toBe(0);
  });

  it('omits "Insert note" between stacked rows', async () => {
    // The rows canvas is row-relative, so offsetY 2 lands in the first row's
    // header strip — inside the note-lane band but inside no row's lanes.
    // Offering an insert there would place a note on an unrelated lane of the
    // active-scope track, so the item must not appear at all.
    const canvas = await mountStackedPanel();
    act(() => {
      fireAt(canvas, 'contextmenu', {x: 300, y: 2, button: 2});
    });
    expect(screen.queryByText('Insert note')).not.toBeInTheDocument();
  });

  // Item 3: signature markers drag like sections and tempo markers, through
  // the same capture / threshold / commit-on-pointer-up pattern.
  it('drags a time-signature marker to a new tick', async () => {
    const canvas = await mountPanel();
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    act(() => {
      screen.getByRole('button', {name: 'Make this a downbeat'}).click();
    });
    const placedTick =
      latest!.state.chartDoc!.parsedChart.timeSignatures.at(-1)!.tick;

    const chipX = findTsChipHitX(canvas);
    expect(chipX).toBeGreaterThanOrEqual(0);
    act(() => {
      fireAt(canvas, 'pointerdown', {x: 400, y: 100}); // dismiss the menu
      fireAt(canvas, 'pointerup', {x: 400, y: 100});
    });

    act(() => {
      fireAt(canvas, 'pointerdown', {x: chipX, y: TEMPO_LANE.y});
      fireAt(canvas, 'pointermove', {x: chipX + 60, y: TEMPO_LANE.y});
      fireAt(canvas, 'pointerup', {x: chipX + 60, y: TEMPO_LANE.y});
    });

    const ticks = latest!.state.chartDoc!.parsedChart.timeSignatures.map(
      ts => ts.tick,
    );
    // The marker now anchors a later bar; the measure it left behind takes
    // its own signature, exactly as a fresh placement would.
    expect(Math.max(...ticks)).toBeGreaterThan(placedTick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it('a signature drag under the threshold leaves the chart alone', async () => {
    const canvas = await mountPanel();
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    act(() => {
      screen.getByRole('button', {name: 'Make this a downbeat'}).click();
    });
    const before = latest!.state.chartDoc!.parsedChart.timeSignatures.map(
      ts => ts.tick,
    );
    const chipX = findTsChipHitX(canvas);
    act(() => {
      fireAt(canvas, 'pointerdown', {x: 400, y: 100});
      fireAt(canvas, 'pointerup', {x: 400, y: 100});
    });

    act(() => {
      fireAt(canvas, 'pointerdown', {x: chipX, y: TEMPO_LANE.y});
      fireAt(canvas, 'pointermove', {x: chipX + 1, y: TEMPO_LANE.y});
      fireAt(canvas, 'pointerup', {x: chipX + 1, y: TEMPO_LANE.y});
    });
    expect(
      latest!.state.chartDoc!.parsedChart.timeSignatures.map(ts => ts.tick),
    ).toEqual(before);
  });

  it('gutter "manage tracks" menu lists every track, not just the visible ones, and can re-show a hidden one', async () => {
    // Three tracks, two visible (so the stacked layout — which needs >1
    // visible row — is reachable at all) and one Chart-Matrix-hidden. The
    // gutter's checklist must still offer the hidden one so it can be
    // checked back on without leaving the piano roll.
    latest = null;
    const parsed = createEmptyChart({bpm: 120, resolution: 480});
    parsed.trackData.push(emptyTrackData('drums', 'expert'));
    parsed.trackData.push(emptyTrackData('drums', 'hard'));
    parsed.trackData.push(emptyTrackData('drums', 'medium'));
    const doc: ChartDocument = {parsedChart: parsed, assets: []};
    addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
    addDrumNote(doc.parsedChart.trackData[1], {tick: 0, type: noteTypes.kick});
    addDrumNote(doc.parsedChart.trackData[2], {tick: 0, type: noteTypes.kick});

    const {container} = render(
      <ChartEditorProvider>
        <SeedDoc make={() => doc} />
        <SeedVisibleTracks trackIds={['drums:expert', 'drums:hard']} />
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

    act(() => {
      // x inside STACKED_GUTTER_W (112px) routes to the gutter menu.
      fireAt(canvas, 'contextmenu', {x: 40, y: 5, button: 2});
    });
    expect(screen.getByText('drums · expert')).toBeInTheDocument();
    expect(screen.getByText('drums · hard')).toBeInTheDocument();
    expect(screen.getByText('drums · medium')).toBeInTheDocument();

    act(() => {
      screen.getByText('drums · medium').click();
    });
    expect(latest!.state.visibleTrackKeys.has('drums:medium')).toBe(true);
  });

  it('offers "Clear loop" inside the loop band and clears the region', async () => {
    const canvas = await mountPanel();
    act(() => {
      // A loop wide enough that any ruler x is inside the shaded band.
      latest!.dispatch({
        type: 'SET_LOOP_REGION',
        region: {startMs: 0, endMs: 1_000_000},
      });
    });
    act(() => {
      fireAt(canvas, 'contextmenu', {x: 300, y: 12, button: 2});
    });
    const clear = screen.getByRole('button', {name: 'Clear loop'});
    act(() => {
      clear.click();
    });
    expect(latest!.state.loopRegion).toBeNull();
  });

  it('keeps the section menu on a flag inside the loop band', async () => {
    const canvas = await mountPanel();
    act(() => {
      latest!.dispatch({
        type: 'SET_LOOP_REGION',
        region: {startMs: 0, endMs: 1_000_000},
      });
    });
    // The fixture's "Intro" flag sits at tick 0, i.e. x = 0 in the ruler.
    act(() => {
      fireAt(canvas, 'contextmenu', {x: 2, y: 12, button: 2});
    });
    expect(screen.getByText('Rename section…')).toBeInTheDocument();
    expect(screen.queryByText('Clear loop')).not.toBeInTheDocument();
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

describe('Tap tempo (tempo-lane menu → in-place tap tool)', () => {
  /** Keydown with a controlled input timestamp: the fit reads
   *  `event.timeStamp`, which jsdom stamps with "now" for every synthetic
   *  event. */
  function tapKey(timeStamp: number) {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'timeStamp', {value: timeStamp});
    act(() => {
      window.dispatchEvent(event);
    });
  }

  /** Four taps 400 ms apart: 150 BPM, and enough to enable Accept. The
   *  fixture's own markers are 120 and 140, so 150 is unambiguous. */
  function tapFourAt150() {
    for (let i = 0; i < 4; i++) tapKey(1000 + i * 400);
  }

  function openTapTool(canvas: HTMLCanvasElement, x = TEMPO_LANE.x) {
    act(() => {
      fireAt(canvas, 'contextmenu', {x, y: TEMPO_LANE.y, button: 2});
    });
    act(() => {
      screen.getByRole('button', {name: 'Tap tempo…'}).click();
    });
    return screen.getByTestId('tap-tempo-popover');
  }

  /** Lowest tempo-lane x that hits a drawn tempo marker, or -1. */
  function findMarkerHitX(canvas: HTMLCanvasElement): number {
    for (let x = 0; x <= 780; x += 1) {
      act(() => {
        fireAt(canvas, 'contextmenu', {x, y: TEMPO_LANE.y, button: 2});
      });
      if (screen.queryByText(/Delete tempo marker/)) return x;
    }
    return -1;
  }

  it('offers the tap tool on empty lane, on a marker and on a signature chip', async () => {
    const canvas = await mountPanel();
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    expect(screen.getByText('Tap tempo…')).toBeInTheDocument();

    const markerX = findMarkerHitX(canvas);
    expect(markerX).toBeGreaterThanOrEqual(0);
    expect(screen.getByText('Tap tempo…')).toBeInTheDocument();

    // Place a bar line so the lane paints an authored signature chip.
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    act(() => {
      screen.getByRole('button', {name: 'Make this a downbeat'}).click();
    });
    const chipX = findTsChipHitX(canvas);
    expect(chipX).toBeGreaterThan(0);
    expect(screen.getByText('Tap tempo…')).toBeInTheDocument();
  });

  it('replaces the menu in place and survives a click on the canvas', async () => {
    const canvas = await mountPanel();
    openTapTool(canvas);

    // The action list is gone; the tool took its place at the same anchor.
    expect(screen.queryByText('Add tempo marker here')).not.toBeInTheDocument();

    act(() => {
      fireAt(canvas, 'pointerdown', {x: 400, y: 100});
      fireAt(canvas, 'pointerup', {x: 400, y: 100});
    });
    expect(screen.getByTestId('tap-tempo-popover')).toBeInTheDocument();
  });

  it('closes the popover on any other tempo-lane item', async () => {
    const canvas = await mountPanel();
    act(() => {
      fireAt(canvas, 'contextmenu', {...TEMPO_LANE, button: 2});
    });
    act(() => {
      screen.getByRole('button', {name: 'Add tempo marker here'}).click();
    });
    expect(screen.queryByText('Tap tempo…')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tap-tempo-popover')).not.toBeInTheDocument();
  });

  it('writes the tapped BPM at the anchor tick on Accept', async () => {
    const canvas = await mountPanel();
    const before = latest!.state.chartDoc!.parsedChart.tempos.map(t => t.tick);
    openTapTool(canvas);
    tapFourAt150();

    act(() => {
      screen.getByRole('button', {name: 'Accept'}).click();
    });

    const after = latest!.state.chartDoc!.parsedChart.tempos;
    const tapped = after.filter(t => Math.abs(t.beatsPerMinute - 150) < 0.01);
    expect(tapped).toHaveLength(1);
    expect(before).not.toContain(tapped[0].tick);
    expect(screen.queryByTestId('tap-tempo-popover')).not.toBeInTheDocument();
  });

  it('leaves the tempo map alone on Cancel', async () => {
    const canvas = await mountPanel();
    const before = latest!.state.chartDoc!.parsedChart.tempos;
    openTapTool(canvas);
    tapFourAt150();

    act(() => {
      screen.getByRole('button', {name: 'Cancel'}).click();
    });

    expect(latest!.state.chartDoc!.parsedChart.tempos).toEqual(before);
    expect(screen.queryByTestId('tap-tempo-popover')).not.toBeInTheDocument();
  });

  it('closes on Escape without clearing the selection hotkey path', async () => {
    const canvas = await mountPanel();
    openTapTool(canvas);
    tapFourAt150();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
      );
    });
    expect(screen.queryByTestId('tap-tempo-popover')).not.toBeInTheDocument();
  });
});
