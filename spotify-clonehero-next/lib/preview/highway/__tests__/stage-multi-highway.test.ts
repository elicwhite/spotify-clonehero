/**
 * @jest-environment jsdom
 */
/**
 * Three real highways on one stage, end to end.
 *
 * `teardown.test.ts` pins the stage's lifecycle and its scissor bookkeeping
 * with note-less highways. This file pins the part a note-less highway cannot
 * see: with three *real* instrument tracks side by side, every root has to
 * finish building its own cell, and every render pass has to receive that
 * root's own camera aimed at that root's own rect -- with the layer masks that
 * let the pass actually see the root's geometry.
 *
 * The live symptom this regression-pins: only the leftmost lane drew, the rest
 * of the strip stayed pure black.
 *
 * Only THREE's `WebGLRenderer` and `TextureLoader` are faked (jsdom has no
 * WebGL context and no image decoding). The scene graph, the roots, the
 * cameras, the layer stamping, and the cell build all run for real.
 */

import * as THREE from 'three';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {setupStage} from '../index';
import {computeStageLayout, toGlRect} from '../layout';
import type {ParsedChart} from '../../chorus-chart-processing';
import type {Track} from '../types';
import type {AudioManager} from '@/lib/preview/audioManager';

interface RenderCall {
  scene: THREE.Scene;
  camera: THREE.Camera;
  viewport: [number, number, number, number] | null;
  scissor: [number, number, number, number] | null;
}

const rendererStubs: FakeRenderer[] = [];
const renderCalls: RenderCall[] = [];

interface FakeRenderer {
  domElement: HTMLCanvasElement;
  renderLists: {dispose: jest.Mock};
  setAnimationLoop: jest.Mock;
}

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
    private viewport: [number, number, number, number] | null = null;
    private scissor: [number, number, number, number] | null = null;
    setViewport = jest.fn((x: number, y: number, w: number, h: number) => {
      this.viewport = [x, y, w, h];
    });
    setScissor = jest.fn((x: number, y: number, w: number, h: number) => {
      this.scissor = [x, y, w, h];
    });
    setScissorTest = jest.fn();
    render = jest.fn((scene: THREE.Scene, camera: THREE.Camera) => {
      renderCalls.push({
        scene,
        camera,
        viewport: this.viewport,
        scissor: this.scissor,
      });
    });
    constructor() {
      rendererStubs.push(this as unknown as FakeRenderer);
    }
  }
  const makeTexture = () => {
    const texture = new actual.Texture();
    // Sprite sizing reads `texture.image.width`; jsdom decodes nothing.
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

beforeEach(() => {
  rendererStubs.length = 0;
  renderCalls.length = 0;
});

function makeTrack(instrument: Track['instrument']): Track {
  return {
    instrument,
    difficulty: 'expert',
    noteEventGroups: [],
    starPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    rejectedChartModifiers: [],
  } as unknown as Track;
}

function makeChart(): ParsedChart {
  const chart = createEmptyChart({
    bpm: 120,
    resolution: 480,
  }) as unknown as ParsedChart;
  (chart.trackData as Track[]).push(
    makeTrack('guitar'),
    makeTrack('bass'),
    makeTrack('drums'),
  );
  return chart;
}

function makeHost(): React.RefObject<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return {current: host} as React.RefObject<HTMLDivElement>;
}

const LANES = [
  {id: 'guitar-expert', instrument: 'guitar' as const},
  {id: 'bass-expert', instrument: 'bass' as const},
  {id: 'drums-expert', instrument: 'drums' as const},
];

describe('three side-by-side highways', () => {
  it('builds every root and gives every pass its own camera, rect, and visible geometry', async () => {
    const chart = makeChart();
    const host = makeHost();
    const stage = setupStage(
      chart,
      host,
      host,
      () => ({}) as unknown as AudioManager,
    );

    const handles = [];
    for (const lane of LANES) {
      handles.push(
        await stage.addHighway(lane.id, {
          track: chart.trackData.find(
            t => t.instrument === lane.instrument,
          ) as Track,
          showDrumLanes: true,
        }),
      );
    }
    expect(handles.every(h => h !== null)).toBe(true);

    const layout = computeStageLayout({
      canvasWidth: 900,
      canvasHeight: 600,
      highwayCount: 3,
    });
    stage.setLayout(
      layout,
      LANES.map(l => l.id),
    );
    stage.startRender();

    const frame = rendererStubs[0].setAnimationLoop.mock
      .calls[0][0] as () => void;
    frame();

    // ---- one pass per highway, each with its own camera and its own rect ----
    expect(renderCalls).toHaveLength(3);
    const scene = renderCalls[0].scene;
    for (let i = 0; i < LANES.length; i++) {
      const call = renderCalls[i];
      const camera = handles[i]!.getCamera();
      const gl = toGlRect(layout.highways[i], 600);
      expect(call.camera).toBe(camera);
      expect(call.viewport).toEqual([gl.x, gl.y, gl.width, gl.height]);
      expect(call.scissor).toEqual([gl.x, gl.y, gl.width, gl.height]);
      // No two passes may share a camera -- one camera for all of them draws
      // the leftmost highway into every viewport.
      for (let j = 0; j < LANES.length; j++) {
        if (i !== j) expect(call.camera).not.toBe(handles[j]!.getCamera());
      }
    }

    // ---- every root actually built its cell ----
    const roots = scene.children.filter(child =>
      child.name.startsWith('HighwayRoot'),
    );
    expect(roots).toHaveLength(3);
    for (const root of roots) {
      const drawn: THREE.Object3D[] = [];
      root.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          drawn.push(object);
        }
      });
      // The textured floor plus the instrument hitline, at minimum.
      expect(drawn.length).toBeGreaterThanOrEqual(2);
    }

    // ---- each root's geometry is visible to its own camera only ----
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const drawables: THREE.Object3D[] = [];
      root.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          drawables.push(object);
        }
      });
      expect(drawables.length).toBeGreaterThan(0);
      for (const object of drawables) {
        for (let j = 0; j < handles.length; j++) {
          const camera = handles[j]!.getCamera();
          expect(object.layers.test(camera.layers)).toBe(i === j);
        }
      }
    }

    stage.destroy();
  });

  it('gives a highway mounted after the layout push its rect', async () => {
    // React pushes one layout per commit, from the parent effect. StrictMode
    // replays a newly mounted lane's effect *after* that push (add ->
    // setLayout -> remove -> add), and any lane toggled on later mounts in a
    // commit of its own. A stage that only assigns rects inside `setLayout`
    // therefore leaves those highways rect-less, and a rect-less highway is
    // skipped by the frame loop: it renders pure black forever.
    const chart = makeChart();
    const host = makeHost();
    const stage = setupStage(
      chart,
      host,
      host,
      () => ({}) as unknown as AudioManager,
    );

    const trackFor = (instrument: Track['instrument']) =>
      chart.trackData.find(t => t.instrument === instrument) as Track;

    await stage.addHighway('guitar-expert', {
      track: trackFor('guitar'),
      showDrumLanes: true,
    });
    await stage.addHighway('bass-expert', {
      track: trackFor('bass'),
      showDrumLanes: true,
    });

    // The layout names all three even though only two are mounted -- the
    // third's lane is in the same React commit, its `addHighway` just has
    // not landed yet.
    const layout = computeStageLayout({
      canvasWidth: 900,
      canvasHeight: 600,
      highwayCount: 3,
    });
    const ids = ['guitar-expert', 'bass-expert', 'drums-expert'];
    stage.setLayout(layout, ids);

    const late = await stage.addHighway('drums-expert', {
      track: trackFor('drums'),
      showDrumLanes: true,
    });
    expect(late!.getCamera().aspect).toBeCloseTo(
      layout.highways[2].width / layout.highways[2].height,
    );

    stage.startRender();
    const frame = rendererStubs[0].setAnimationLoop.mock
      .calls[0][0] as () => void;
    renderCalls.length = 0;
    frame();

    expect(renderCalls).toHaveLength(3);
    const gl = toGlRect(layout.highways[2], 600);
    const lastPass = renderCalls.find(c => c.camera === late!.getCamera());
    expect(lastPass?.scissor).toEqual([gl.x, gl.y, gl.width, gl.height]);

    // A highway the retained layout does not name still draws nothing.
    const unnamed = await stage.addHighway('keys-expert', {
      track: null,
      showDrumLanes: false,
    });
    renderCalls.length = 0;
    frame();
    expect(renderCalls).toHaveLength(3);
    expect(renderCalls.some(c => c.camera === unnamed!.getCamera())).toBe(
      false,
    );

    stage.destroy();
  });

  it('survives the editor mount pattern: three concurrent adds through a StrictMode remount', async () => {
    const chart = makeChart();
    const host = makeHost();
    const stage = setupStage(
      chart,
      host,
      host,
      () => ({}) as unknown as AudioManager,
    );

    const layout = computeStageLayout({
      canvasWidth: 900,
      canvasHeight: 600,
      highwayCount: 3,
    });
    const ids = LANES.map(l => l.id);
    const add = () =>
      LANES.map(lane =>
        stage.addHighway(lane.id, {
          track: chart.trackData.find(
            t => t.instrument === lane.instrument,
          ) as Track,
          showDrumLanes: true,
        }),
      );

    // The real commit order: every lane effect mounts (concurrent adds), the
    // parent effect pushes the layout, and only then does StrictMode replay
    // each lane's effect -- tearing every highway down and re-adding it after
    // the one and only layout push.
    const firstRound = add();
    stage.setLayout(layout, ids);
    for (const id of ids) stage.removeHighway(id);
    const handles = await Promise.all(add());
    await Promise.all(firstRound);

    stage.startRender();

    expect(handles.every(h => h !== null)).toBe(true);
    const frame = rendererStubs[0].setAnimationLoop.mock
      .calls[0][0] as () => void;
    renderCalls.length = 0;
    frame();

    expect(renderCalls).toHaveLength(3);
    const scene = renderCalls[0].scene;
    const roots = scene.children.filter(child =>
      child.name.startsWith('HighwayRoot'),
    );
    // The abandoned first round left nothing behind.
    expect(roots).toHaveLength(3);
    for (const root of roots) {
      const drawn: THREE.Object3D[] = [];
      root.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          drawn.push(object);
        }
      });
      expect(drawn.length).toBeGreaterThanOrEqual(2);
    }
    for (let i = 0; i < ids.length; i++) {
      const gl = toGlRect(layout.highways[i], 600);
      expect(renderCalls[i].camera).toBe(handles[i]!.getCamera());
      expect(renderCalls[i].scissor).toEqual([gl.x, gl.y, gl.width, gl.height]);
    }

    stage.destroy();
  });
});
