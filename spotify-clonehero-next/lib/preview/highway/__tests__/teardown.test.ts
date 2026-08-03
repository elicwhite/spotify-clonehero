/**
 * @jest-environment jsdom
 */
/**
 * Deterministic renderer teardown (plan 0074 Phase 3 spike requirement).
 *
 * Multi-pane highway mounting churns renderers fast enough that a pane can
 * be destroyed more than once in the same tick; a second `dispose()` /
 * `forceContextLoss()` on an already-lost context is what the spike saw as
 * `webglcontextlost` churn. `setupRenderer().destroy()` therefore has to be
 * idempotent, and its GPU release has to happen synchronously inside the
 * call rather than in some later microtask.
 *
 * Teardown also has to stay local to the renderer being destroyed:
 * `MarkerRenderer`'s marker-texture cache is module-scoped and shared by
 * every live renderer, so a pane closing while its siblings are up must
 * leave those textures alone.
 *
 * Only THREE's `WebGLRenderer` is faked (jsdom has no WebGL context); every
 * other part of `setupRenderer` runs for real.
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import {MarkerRenderer, setupRenderer} from '../index';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {ChartResponseEncore} from '@/lib/chartSelection';

const rendererStubs: FakeRenderer[] = [];

interface FakeRenderer {
  domElement: HTMLCanvasElement;
  renderLists: {dispose: jest.Mock};
  setPixelRatio: jest.Mock;
  setSize: jest.Mock;
  setAnimationLoop: jest.Mock;
  dispose: jest.Mock;
  forceContextLoss: jest.Mock;
  render: jest.Mock;
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
    render = jest.fn();
    localClippingEnabled = false;
    outputColorSpace: unknown = null;
    constructor() {
      rendererStubs.push(this);
    }
  }
  return {...actual, WebGLRenderer: FakeWebGLRenderer};
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
});

function makeRenderer() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const sizing = {current: host} as React.RefObject<HTMLDivElement>;
  const mount = {current: host} as React.RefObject<HTMLDivElement>;
  return setupRenderer(
    {song_length: 60_000} as ChartResponseEncore,
    createEmptyChart({bpm: 120, resolution: 480}),
    sizing,
    mount,
    {} as AudioManager,
  );
}

describe('setupRenderer teardown', () => {
  it('releases the GPU context synchronously on destroy and only once', async () => {
    const handle = makeRenderer();
    const stub = rendererStubs[0];
    expect(stub.domElement.isConnected).toBe(true);

    // Not awaited: everything the spike requires must already have run by
    // the time destroy() returns its promise.
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

  it('leaves the shared marker-texture cache alone until the last renderer is destroyed', async () => {
    const clearCache = jest.spyOn(MarkerRenderer, 'clearTextureCache');
    try {
      const first = makeRenderer();
      const second = makeRenderer();

      await first.destroy();
      // `second`'s marker sprites still hold textures from the shared cache.
      expect(clearCache).not.toHaveBeenCalled();

      await second.destroy();
      expect(clearCache).toHaveBeenCalledTimes(1);
    } finally {
      clearCache.mockRestore();
    }
  });
});
