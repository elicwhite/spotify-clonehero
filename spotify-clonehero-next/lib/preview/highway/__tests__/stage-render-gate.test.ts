/**
 * @jest-environment jsdom
 */
/**
 * The stage only draws frames that can differ from the last one.
 *
 * `renderGate.test.ts` pins the decision in isolation. This file pins the
 * wiring around it: which pushes wake the loop, that an idle stage parks its
 * rAF loop and hands over to the low-rate poll, and that the poll brings it
 * back when the transport moves underneath with nothing pushed.
 *
 * Only THREE's `WebGLRenderer` and `TextureLoader` are faked (jsdom has no
 * WebGL context and no image decoding).
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import {setupStage, type HighwayStage} from '../index';
import {computeStageLayout} from '../layout';
import {DEFAULT_LINGER_MS} from '../renderGate';
import type {ParsedChart} from '../../chorus-chart-processing';
import type {Track} from '../types';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {ChartResponseEncore} from '@/lib/chartSelection';

interface FakeRenderer {
  setAnimationLoop: jest.Mock;
  render: jest.Mock;
}

const rendererStubs: FakeRenderer[] = [];

jest.mock('three', () => {
  const actual = jest.requireActual('three');
  class FakeWebGLRenderer {
    domElement = document.createElement('canvas');
    renderLists = {dispose: jest.fn()};
    setPixelRatio = jest.fn();
    setSize = jest.fn();
    setAnimationLoop = jest.fn();
    dispose = jest.fn();
    forceContextLoss = jest.fn();
    clear = jest.fn();
    autoClear = true;
    localClippingEnabled = false;
    outputColorSpace: unknown = null;
    setViewport = jest.fn();
    setScissor = jest.fn();
    setScissorTest = jest.fn();
    render = jest.fn();
    constructor() {
      rendererStubs.push(this as unknown as FakeRenderer);
    }
  }
  const makeTexture = () => {
    const texture = new actual.Texture();
    texture.image = {width: 64, height: 64};
    return texture;
  };
  class FakeTextureLoader {
    async loadAsync() {
      return makeTexture();
    }
    load() {
      return makeTexture();
    }
  }
  return {
    ...actual,
    WebGLRenderer: FakeWebGLRenderer,
    TextureLoader: FakeTextureLoader,
  };
});

const metadata = {song_length: 60_000} as ChartResponseEncore;

function makeChart(): ParsedChart {
  const chart = createEmptyChart({
    bpm: 120,
    resolution: 480,
  }) as unknown as ParsedChart;
  (chart.trackData as Track[]).push({
    instrument: 'drums',
    difficulty: 'expert',
    noteEventGroups: [],
    starPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    rejectedChartModifiers: [],
  } as unknown as Track);
  return chart;
}

/** Minimal transport the stage reads: a chart clock and a playing flag. */
class FakeAudio {
  chartTime = 0;
  isPlaying = false;
  isInitialized = true;
  delay = 0;
  chartDelay = 0;
}

interface Harness {
  stage: HighwayStage;
  audio: FakeAudio;
  renderer: FakeRenderer;
  /** Run the currently armed animation callback, if there is one. */
  frame(): void;
  /** Whether the rAF loop is armed right now. */
  isArmed(): boolean;
  /** Draw calls issued since the last `resetDraws()`. */
  draws(): number;
  resetDraws(): void;
  now: number;
}

async function setup(): Promise<Harness> {
  const chart = makeChart();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const audio = new FakeAudio();
  const ref = {current: host} as React.RefObject<HTMLDivElement>;
  const stage = setupStage(
    metadata,
    chart,
    ref,
    ref,
    audio as unknown as AudioManager,
  );
  await stage.addHighway('drums-expert', {
    track: chart.trackData[0] as Track,
    showDrumLanes: true,
  });
  stage.setLayout(
    computeStageLayout({
      canvasWidth: 900,
      canvasHeight: 600,
      highwayCount: 1,
    }),
    ['drums-expert'],
  );
  const renderer = rendererStubs[rendererStubs.length - 1];

  const harness: Harness = {
    stage,
    audio,
    renderer,
    now: 0,
    isArmed() {
      const calls = renderer.setAnimationLoop.mock.calls;
      return calls.length > 0 && calls[calls.length - 1][0] !== null;
    },
    frame() {
      const calls = renderer.setAnimationLoop.mock.calls;
      const loop = calls.length > 0 ? calls[calls.length - 1][0] : null;
      if (typeof loop === 'function') loop();
    },
    draws() {
      return renderer.render.mock.calls.length;
    },
    resetDraws() {
      renderer.render.mockClear();
    },
  };
  return harness;
}

/** Drain the microtask the stage parks on. */
const flushMicrotasks = () => Promise.resolve();

beforeEach(() => {
  rendererStubs.length = 0;
  // The stage parks on a microtask, and the wall clock is driven by the spy
  // below, so neither is handed to the fake timers.
  jest.useFakeTimers({doNotFake: ['queueMicrotask', 'performance']});
  jest.spyOn(performance, 'now').mockReturnValue(0);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function setNow(ms: number): void {
  (performance.now as jest.Mock).mockReturnValue(ms);
}

describe('stage render gating', () => {
  it('draws the first frame and stops drawing while nothing changes', async () => {
    const h = await setup();
    h.stage.startRender();
    expect(h.isArmed()).toBe(true);

    h.resetDraws();
    h.frame();
    expect(h.draws()).toBe(1);

    setNow(16);
    h.frame();
    setNow(32);
    h.frame();
    expect(h.draws()).toBe(1);
  });

  it('parks the rAF loop once the linger window expires', async () => {
    const h = await setup();
    h.stage.startRender();
    h.frame();

    setNow(DEFAULT_LINGER_MS - 1);
    h.frame();
    await flushMicrotasks();
    expect(h.isArmed()).toBe(true);

    setNow(DEFAULT_LINGER_MS);
    h.frame();
    await flushMicrotasks();
    expect(h.isArmed()).toBe(false);
  });

  it('re-arms on a layout push', async () => {
    const h = await setup();
    h.stage.startRender();
    h.frame();
    setNow(DEFAULT_LINGER_MS);
    h.frame();
    await flushMicrotasks();
    expect(h.isArmed()).toBe(false);

    h.stage.setLayout(
      computeStageLayout({
        canvasWidth: 800,
        canvasHeight: 600,
        highwayCount: 1,
      }),
      ['drums-expert'],
    );
    expect(h.isArmed()).toBe(true);
    h.resetDraws();
    h.frame();
    expect(h.draws()).toBe(1);
  });

  it('re-arms on an overlay-state push', async () => {
    const h = await setup();
    h.stage.startRender();
    h.frame();
    setNow(DEFAULT_LINGER_MS);
    h.frame();
    await flushMicrotasks();
    expect(h.isArmed()).toBe(false);

    h.stage.getHighway('drums-expert')!.setOverlayState({
      cursorTick: 480,
      isPlaying: false,
      activeTool: 'cursor',
      hoverLane: 2,
      hoverTick: 480,
      loopRegion: null,
    });
    expect(h.isArmed()).toBe(true);
  });

  it('re-arms when the reconciler is mutated behind the stage', async () => {
    const h = await setup();
    const reconciler = await h.stage
      .getHighway('drums-expert')!
      .getReconciler();
    h.stage.startRender();
    h.frame();
    setNow(DEFAULT_LINGER_MS);
    h.frame();
    await flushMicrotasks();
    expect(h.isArmed()).toBe(false);

    reconciler.setHoveredKey('some-note');
    expect(h.isArmed()).toBe(true);
  });

  it('the idle poll re-arms when chart time moves with nothing pushed', async () => {
    const h = await setup();
    h.stage.startRender();
    h.frame();
    setNow(DEFAULT_LINGER_MS);
    h.frame();
    await flushMicrotasks();
    expect(h.isArmed()).toBe(false);

    // Nothing moved: the poll leaves the loop parked.
    jest.advanceTimersByTime(1000);
    expect(h.isArmed()).toBe(false);

    // A seek from outside the stage (the transport's section jump).
    h.audio.chartTime = 12;
    jest.advanceTimersByTime(200);
    expect(h.isArmed()).toBe(true);
    h.resetDraws();
    h.frame();
    expect(h.draws()).toBe(1);
  });

  it('draws every frame while audio is playing', async () => {
    const h = await setup();
    h.stage.startRender();
    h.frame();
    h.audio.isPlaying = true;
    h.resetDraws();
    for (let i = 1; i <= 5; i++) {
      setNow(i * 16);
      h.audio.chartTime = i * 0.016;
      h.frame();
    }
    expect(h.draws()).toBe(5);
    await flushMicrotasks();
    expect(h.isArmed()).toBe(true);
  });

  it('destroy clears the idle poll and leaves the loop parked', async () => {
    const h = await setup();
    h.stage.startRender();
    h.frame();
    setNow(DEFAULT_LINGER_MS);
    h.frame();
    await flushMicrotasks();
    expect(h.isArmed()).toBe(false);

    h.stage.destroy();
    h.audio.chartTime = 30;
    jest.advanceTimersByTime(1000);
    expect(h.isArmed()).toBe(false);
  });
});
