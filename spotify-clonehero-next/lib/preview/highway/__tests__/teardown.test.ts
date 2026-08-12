/**
 * @jest-environment jsdom
 */
/**
 * Deterministic teardown, for both renderer entry points.
 *
 * Highway mounting churns fast enough that a renderer or stage can be
 * destroyed more than once in the same tick; a second `dispose()` /
 * `forceContextLoss()` on an already-lost context is what the plan-0074 spike
 * saw as `webglcontextlost` churn. `destroy()` therefore has to be idempotent,
 * and its GPU release has to happen synchronously inside the call rather than
 * in some later microtask.
 *
 * The stage adds two more contracts jsdom can pin: mounting a highway builds
 * no second `WebGLRenderer` and unmounting one releases no context, and the
 * frame loop clears the whole canvas before any scissor is in force (without
 * which the inter-highway gaps keep stale, driver-dependent pixels).
 *
 * Only THREE's `WebGLRenderer` and `TextureLoader` are faked (jsdom has no
 * WebGL context and no image decoding); every other part runs for real.
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import {setupRenderer, setupStage} from '../index';
import {computeStageLayout, type StageLayout} from '../layout';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {ChartResponseEncore} from '@/lib/chartSelection';

const rendererStubs: FakeRenderer[] = [];
/** Every state-changing renderer call of the current frame, in order. */
const frameLog: string[] = [];

interface FakeRenderer {
  domElement: HTMLCanvasElement;
  renderLists: {dispose: jest.Mock};
  setPixelRatio: jest.Mock;
  setSize: jest.Mock;
  setAnimationLoop: jest.Mock;
  dispose: jest.Mock;
  forceContextLoss: jest.Mock;
  render: jest.Mock;
  clear: jest.Mock;
  setViewport: jest.Mock;
  setScissor: jest.Mock;
  setScissorTest: jest.Mock;
  autoClear: boolean;
  localClippingEnabled: boolean;
  outputColorSpace: unknown;
}

jest.mock('three', () => {
  const actual = jest.requireActual('three');
  class FakeWebGLRenderer implements FakeRenderer {
    domElement = document.createElement('canvas');
    renderLists = {dispose: jest.fn()};
    setPixelRatio = jest.fn();
    setSize = jest.fn();
    setAnimationLoop = jest.fn();
    dispose = jest.fn();
    forceContextLoss = jest.fn();
    render = jest.fn(() => {
      frameLog.push('render');
    });
    clear = jest.fn(() => {
      frameLog.push('clear');
    });
    setViewport = jest.fn((x: number, y: number, w: number, h: number) => {
      frameLog.push(`setViewport(${x},${y},${w},${h})`);
    });
    setScissor = jest.fn((x: number, y: number, w: number, h: number) => {
      frameLog.push(`setScissor(${x},${y},${w},${h})`);
    });
    setScissorTest = jest.fn((enabled: boolean) => {
      frameLog.push(`setScissorTest(${enabled})`);
    });
    autoClear = true;
    localClippingEnabled = false;
    outputColorSpace: unknown = null;
    constructor() {
      rendererStubs.push(this);
    }
  }
  class FakeTextureLoader {
    async loadAsync() {
      return new actual.Texture();
    }
    load() {
      return new actual.Texture();
    }
  }
  return {
    ...actual,
    WebGLRenderer: FakeWebGLRenderer,
    TextureLoader: FakeTextureLoader,
  };
});

class FakeResizeObserver {
  observe = jest.fn();
  disconnect = jest.fn();
  unobserve = jest.fn();
}

beforeAll(() => {
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver =
    FakeResizeObserver;
});

beforeEach(() => {
  rendererStubs.length = 0;
  frameLog.length = 0;
});

function makeHost(): React.RefObject<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return {current: host} as React.RefObject<HTMLDivElement>;
}

const metadata = {song_length: 60_000} as ChartResponseEncore;

function makeRenderer() {
  const host = makeHost();
  return setupRenderer(
    metadata,
    createEmptyChart({bpm: 120, resolution: 480}),
    host,
    host,
    {} as AudioManager,
  );
}

function makeStage(audioManager: AudioManager = {} as AudioManager) {
  const host = makeHost();
  return setupStage(
    createEmptyChart({bpm: 120, resolution: 480}),
    host,
    host,
    () => audioManager,
  );
}

describe.each([
  ['setupRenderer', makeRenderer],
  ['setupStage', makeStage],
])('%s teardown', (_name, make) => {
  it('releases the GPU context synchronously on destroy and only once', async () => {
    const handle = make();
    const stub = rendererStubs[0];
    expect(stub.domElement.isConnected).toBe(true);

    // Not awaited: everything the spike requires must already have run by
    // the time destroy() returns.
    const first = handle.destroy();

    expect(stub.setAnimationLoop).toHaveBeenCalledWith(null);
    expect(stub.dispose).toHaveBeenCalledTimes(1);
    expect(stub.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(stub.domElement.isConnected).toBe(false);

    await first;
    await handle.destroy();
    await handle.destroy();

    expect(stub.dispose).toHaveBeenCalledTimes(1);
    expect(stub.forceContextLoss).toHaveBeenCalledTimes(1);
  });
});

describe('stage highway lifecycle', () => {
  it('mounts and unmounts a highway without touching the renderer', async () => {
    const stage = makeStage();
    expect(rendererStubs).toHaveLength(1);
    const stub = rendererStubs[0];

    await stage.addHighway('a', {track: null, showDrumLanes: false});
    await stage.addHighway('b', {track: null, showDrumLanes: false});

    // Two highways, still one context.
    expect(rendererStubs).toHaveLength(1);
    expect(stage.getHighway('a')).not.toBeNull();

    stage.removeHighway('a');
    expect(stage.getHighway('a')).toBeNull();
    expect(stage.getHighway('b')).not.toBeNull();
    expect(stub.dispose).not.toHaveBeenCalled();
    expect(stub.forceContextLoss).not.toHaveBeenCalled();
    expect(stub.setAnimationLoop).not.toHaveBeenCalledWith(null);

    stage.destroy();
  });

  it('disposes only the removed highway and keeps its siblings live across a re-add', async () => {
    const stage = makeStage();
    const a = await stage.addHighway('a', {track: null, showDrumLanes: false});
    const b = await stage.addHighway('b', {track: null, showDrumLanes: false});
    const bReconciler = await b!.getReconciler();

    // Each highway holds its own slot along X, and its camera sits at it.
    expect(a!.getWorldX()).toBe(0);
    expect(b!.getWorldX()).toBeGreaterThan(0);
    expect(a!.getCamera().position.x).toBe(a!.getWorldX());
    expect(b!.getCamera().position.x).toBe(b!.getWorldX());

    stage.removeHighway('a');

    // The removed highway's scene core is gone...
    await expect(a!.getReconciler()).rejects.toThrow(/no reconciler/);
    // ...and its sibling is the same live object it was before.
    expect(stage.getHighway('b')).toBe(b);
    await expect(b!.getReconciler()).resolves.toBe(bReconciler);

    // Toggling a track back on mounts one more highway on the running stage.
    const c = await stage.addHighway('c', {track: null, showDrumLanes: false});
    expect(c).not.toBeNull();
    expect(stage.getHighway('b')).toBe(b);
    // The freed slot is reused, so the strip does not walk off down the X axis
    // as tracks are toggled.
    expect(c!.getWorldX()).toBe(0);
    expect(b!.getWorldX()).toBeGreaterThan(0);
    expect(rendererStubs).toHaveLength(1);
    expect(rendererStubs[0].dispose).not.toHaveBeenCalled();

    stage.destroy();
  });

  it('re-lays out the viewports on resize without recreating the renderer', async () => {
    const stage = makeStage();
    const a = await stage.addHighway('a', {track: null, showDrumLanes: false});
    await stage.addHighway('b', {track: null, showDrumLanes: false});
    const stub = rendererStubs[0];

    const wide = computeStageLayout({
      canvasWidth: 800,
      canvasHeight: 400,
      highwayCount: 2,
    });
    stage.setLayout(wide, ['a', 'b']);
    expect(stub.setSize).toHaveBeenLastCalledWith(800, 400);
    expect(a!.getCamera().aspect).toBeCloseTo(
      wide.highways[0].width / wide.highways[0].height,
    );

    const narrow = computeStageLayout({
      canvasWidth: 400,
      canvasHeight: 300,
      highwayCount: 2,
    });
    stage.setLayout(narrow, ['a', 'b']);

    // The canvas and every camera follow the new size; the context does not.
    expect(stub.setSize).toHaveBeenLastCalledWith(400, 300);
    expect(a!.getCamera().aspect).toBeCloseTo(
      narrow.highways[0].width / narrow.highways[0].height,
    );
    expect(rendererStubs).toHaveLength(1);
    expect(stub.dispose).not.toHaveBeenCalled();
    expect(stub.forceContextLoss).not.toHaveBeenCalled();

    stage.startRender();
    const frame = stub.setAnimationLoop.mock.calls[0][0] as () => void;
    frameLog.length = 0;
    frame();

    const [left, right] = narrow.highways;
    expect(frameLog).toContain(`setViewport(${left.x},0,${left.width},300)`);
    expect(frameLog).toContain(`setViewport(${right.x},0,${right.width},300)`);

    stage.destroy();
  });

  it('clears the whole canvas before any scissored pass, then draws one pass per highway', async () => {
    const stage = makeStage();
    await stage.addHighway('a', {track: null, showDrumLanes: false});
    await stage.addHighway('b', {track: null, showDrumLanes: false});

    const layout = computeStageLayout({
      canvasWidth: 800,
      canvasHeight: 400,
      highwayCount: 2,
    });
    stage.setLayout(layout, ['a', 'b']);
    stage.startRender();

    const stub = rendererStubs[0];
    const frame = stub.setAnimationLoop.mock.calls[0][0] as () => void;
    frameLog.length = 0;
    frame();

    const [left, right] = layout.highways;
    expect(frameLog).toEqual([
      // The full-canvas clear happens with scissor testing off; with it on,
      // only the scissor rect is cleared and the gap keeps stale pixels.
      'setScissorTest(false)',
      'setViewport(0,0,800,400)',
      'setScissor(0,0,800,400)',
      'clear',
      'setScissorTest(true)',
      `setViewport(${left.x},0,${left.width},400)`,
      `setScissor(${left.x},0,${left.width},400)`,
      'render',
      `setViewport(${right.x},0,${right.width},400)`,
      `setScissor(${right.x},0,${right.width},400)`,
      'render',
      // Chart-wide chrome draws over the whole canvas, unscissored.
      'setScissorTest(false)',
      'setViewport(0,0,800,400)',
    ]);
    expect(stub.autoClear).toBe(true);

    stage.destroy();
  });

  it('pairs rects to highways by id, and blanks a highway the layout drops', async () => {
    // Rects are paired to ids, never to mount position, so a reordered or
    // shortened lane list can never hand one highway another's rect --
    // a desync that would present as a raycast tolerance problem, not as a
    // layout bug. Widths differ so a swap is visible in the assertions.
    const stage = makeStage();
    const a = await stage.addHighway('a', {track: null, showDrumLanes: false});
    const b = await stage.addHighway('b', {track: null, showDrumLanes: false});
    const layout: StageLayout = {
      canvas: {width: 800, height: 400},
      highways: [
        {x: 0, y: 0, width: 300, height: 400},
        {x: 300, y: 0, width: 500, height: 400},
      ],
      maxHighways: 6,
      measured: true,
    };

    // Reverse of mount order: 'b' holds the left rect.
    stage.setLayout(layout, ['b', 'a']);
    expect(a!.getCamera().aspect).toBeCloseTo(500 / 400);
    expect(b!.getCamera().aspect).toBeCloseTo(300 / 400);

    stage.startRender();
    const stub = rendererStubs[0];
    const frame = stub.setAnimationLoop.mock.calls[0][0] as () => void;
    frameLog.length = 0;
    frame();
    const scissors = () => frameLog.filter(e => e.startsWith('setScissor('));
    // Passes run in mount order (a, b); each draws into the rect its id was
    // given, after the full-canvas clear.
    expect(scissors()).toEqual([
      'setScissor(0,0,800,400)',
      'setScissor(300,0,500,400)',
      'setScissor(0,0,300,400)',
    ]);

    // 'b' is no longer named: it has no place on the canvas, so it draws
    // nothing rather than keeping a rect that now belongs to 'a'.
    stage.setLayout({...layout, highways: [layout.highways[0]]}, ['a']);
    frameLog.length = 0;
    frame();
    expect(scissors()).toEqual([
      'setScissor(0,0,800,400)',
      'setScissor(0,0,300,400)',
    ]);
    expect(a!.getCamera().aspect).toBeCloseTo(300 / 400);

    stage.destroy();
  });

  it('stops the loop and reports a lost context instead of rendering into it', async () => {
    const stage = makeStage();
    await stage.addHighway('a', {track: null, showDrumLanes: false});
    stage.startRender();
    const stub = rendererStubs[0];
    const lost = jest.fn();
    stage.onContextLost(lost);

    const event = new Event('webglcontextlost', {cancelable: true});
    stub.domElement.dispatchEvent(event);

    // Cancelling the default is what lets the browser hand the canvas a new
    // context for the replacement stage.
    expect(event.defaultPrevented).toBe(true);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(stub.setAnimationLoop).toHaveBeenLastCalledWith(null);

    // Restarting is a no-op: the editor answers a loss by building a new
    // stage, not by resuming this one.
    stub.setAnimationLoop.mockClear();
    stage.startRender();
    expect(stub.setAnimationLoop).not.toHaveBeenCalled();

    stage.destroy();
  });

  it('does not force a second context loss when destroying a lost context', async () => {
    const stage = makeStage();
    const stub = rendererStubs[0];
    const unsubscribe = stage.onContextLost(() => {
      throw new Error('unsubscribed listeners must not run');
    });
    unsubscribe();

    stub.domElement.dispatchEvent(
      new Event('webglcontextlost', {cancelable: true}),
    );
    stage.destroy();

    expect(stub.dispose).toHaveBeenCalledTimes(1);
    expect(stub.forceContextLoss).not.toHaveBeenCalled();
  });

  it('draws the karaoke overlay once, full-canvas, after every scissored pass', async () => {
    // The overlay paints into a 2D canvas jsdom does not implement; only the
    // ordering of the render passes is under test here.
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() =>
      new Proxy({} as Record<string | symbol, unknown>, {
        get: (target, prop) =>
          prop in target
            ? target[prop]
            : () => ({width: 10, addColorStop: () => {}}),
        set: () => true,
      })) as unknown as HTMLCanvasElement['getContext'];
    try {
      // Parked mid-phrase so the overlay has a line to draw.
      const stage = makeStage({chartTime: 0.2} as AudioManager);
      await stage.addHighway('a', {track: null, showDrumLanes: false});
      stage.setLayout(
        computeStageLayout({
          canvasWidth: 800,
          canvasHeight: 400,
          highwayCount: 1,
        }),
        ['a'],
      );
      stage.setLyricsData(
        [{msTime: 0, text: 'hello', msLength: 400}],
        [{msTime: 0, msLength: 1000}],
      );
      stage.startRender();

      const stub = rendererStubs[0];
      const frame = stub.setAnimationLoop.mock.calls[0][0] as () => void;
      frameLog.length = 0;
      frame();

      expect(frameLog.slice(-3)).toEqual([
        'setScissorTest(false)',
        'setViewport(0,0,800,400)',
        'render',
      ]);
      // One overlay pass for the whole strip: the highway pass plus one more.
      expect(frameLog.filter(entry => entry === 'render')).toHaveLength(2);

      stage.destroy();
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });
});
