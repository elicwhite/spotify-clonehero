/**
 * @jest-environment jsdom
 */
/**
 * `renderFrame`, the synchronous draw for a caller that owns its clock, and
 * the stage options such a caller sets. Unlike the animation loop, which
 * survives a bad frame, `renderFrame` throws: when the draw fails, and when
 * the stage is destroyed or its WebGL context is lost. `pixelRatio` and
 * `loadingManager` reach the renderer and the texture loader.
 *
 * Only THREE's `WebGLRenderer` and `TextureLoader` are faked (jsdom has no
 * WebGL context and no image decoding).
 */

import * as THREE from 'three';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {setupStage, type HighwayStage, type StageConfig} from '../stage';
import {computeStageLayout} from '../layout';
import type {ParsedChart} from '../../chorus-chart-processing';
import type {Track} from '../types';

interface FakeRenderer {
  domElement: HTMLCanvasElement;
  setPixelRatio: jest.Mock;
  setAnimationLoop: jest.Mock;
  render: jest.Mock;
  autoClear: boolean;
}

const rendererStubs: FakeRenderer[] = [];
const loaderManagers: unknown[] = [];

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
    constructor(manager?: unknown) {
      loaderManagers.push(manager);
    }
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

/** The members of the playback clock the stage reads. */
const clock = {
  chartTime: 0,
  isPlaying: false,
  isInitialized: true,
  delay: 0,
  chartDelay: 0,
};

async function setup(
  config?: StageConfig,
): Promise<{stage: HighwayStage; renderer: FakeRenderer}> {
  const chart = makeChart();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ref = {current: host} as React.RefObject<HTMLDivElement>;
  const stage = setupStage(chart, ref, ref, () => clock, config);
  await stage.addHighway('drums-expert', {
    track: chart.trackData[0] as Track,
    showDrumLanes: true,
  });
  stage.setLayout(
    computeStageLayout({canvasWidth: 900, canvasHeight: 600, highwayCount: 1}),
    ['drums-expert'],
  );
  return {stage, renderer: rendererStubs[rendererStubs.length - 1]!};
}

describe('renderFrame', () => {
  it('draws synchronously', async () => {
    const {stage, renderer} = await setup();
    renderer.render.mockClear();
    stage.renderFrame(1500);
    expect(renderer.render).toHaveBeenCalled();
    stage.destroy();
  });

  it('throws what the draw throws, and leaves the renderer as it found it', async () => {
    const {stage, renderer} = await setup();
    renderer.render.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => stage.renderFrame(1500)).toThrow('boom');
    expect(renderer.autoClear).toBe(true);
    stage.destroy();
  });

  it('throws once the stage is destroyed', async () => {
    const {stage} = await setup();
    stage.destroy();
    expect(() => stage.renderFrame(0)).toThrow(/destroyed/);
  });

  it('throws once the WebGL context is lost', async () => {
    const {stage, renderer} = await setup();
    const lost = jest.fn();
    stage.onContextLost(lost);
    renderer.domElement.dispatchEvent(
      new Event('webglcontextlost', {cancelable: true}),
    );
    expect(lost).toHaveBeenCalledTimes(1);
    expect(() => stage.renderFrame(0)).toThrow(/context/);
    stage.destroy();
  });

  it('leaves the animation loop surviving a bad frame', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const {stage, renderer} = await setup();
    renderer.render.mockImplementation(() => {
      throw new Error('boom');
    });
    stage.startRender();
    const loop = renderer.setAnimationLoop.mock.calls
      .map(call => call[0] as unknown)
      .filter((fn): fn is () => void => typeof fn === 'function')
      .pop();
    expect(loop).toBeDefined();
    expect(() => loop?.()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      'Highway stage render error:',
      expect.any(Error),
    );
    warn.mockRestore();
    stage.destroy();
  });
});

describe('stage config', () => {
  it('renders at the pixel ratio and through the loading manager given', async () => {
    const manager = new THREE.LoadingManager();
    const {stage, renderer} = await setup({
      pixelRatio: 2,
      loadingManager: manager,
    });
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(loaderManagers[loaderManagers.length - 1]).toBe(manager);
    stage.destroy();
  });

  it("defaults to the display's ratio and three's default manager", async () => {
    const {stage, renderer} = await setup();
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(
      Math.min(window.devicePixelRatio || 1, 2),
    );
    expect(loaderManagers[loaderManagers.length - 1]).toBeUndefined();
    stage.destroy();
  });
});
