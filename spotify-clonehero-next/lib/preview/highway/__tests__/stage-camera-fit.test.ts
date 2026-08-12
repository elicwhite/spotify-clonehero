/**
 * @jest-environment jsdom
 */
/**
 * A full strip of highways at the narrowest lane the layout will produce
 * (plan 0077 item 1).
 *
 * `layout.test.ts` pins the fit math on its own numbers. This file pins what
 * the user actually sees: the stage hands every highway a camera whose
 * projection puts that highway's own floor edges inside that highway's own
 * viewport. The live symptom this regression-pins: with enough highways
 * mounted, each one rendered wider than its scissor rect, so the outer lanes
 * were sliced off at the rect boundary and the strip read as overlapping
 * highways.
 *
 * Only THREE's `WebGLRenderer` and `TextureLoader` are faked (jsdom has no
 * WebGL context and no image decoding); the cameras and their projection
 * matrices are real.
 */

import * as THREE from 'three';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {setupStage} from '../index';
import {
  computeStageLayout,
  HIGHWAY_GAP_PX,
  MAX_HIGHWAYS,
  MIN_HIGHWAY_PX,
} from '../layout';
import {STRIKELINE_WORLD_Y} from '../cameraFit';
import type {ParsedChart} from '../../chorus-chart-processing';
import type {Track} from '../types';
import type {AudioManager} from '@/lib/preview/audioManager';

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


/** Widest highway floor of the two the editor mounts (five-fret 1.1). */
const HALF_WIDTHS: Record<string, number> = {
  guitar: 0.55,
  bass: 0.55,
  drums: 0.45,
};

const LANES = [
  'guitar',
  'bass',
  'drums',
  'guitar',
  'bass',
  'drums',
] as const satisfies readonly Track['instrument'][];

const CANVAS_HEIGHT = 420;

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

/** Where a world point lands in its camera's viewport, in NDC. */
function project(camera: THREE.Camera, x: number, y: number): THREE.Vector3 {
  camera.updateMatrixWorld(true);
  return new THREE.Vector3(x, y, 0).project(camera);
}

async function mountStrip(canvasWidth: number, count: number) {
  const chart = makeChart();
  const host = makeHost();
  const stage = setupStage(
    chart,
    host,
    host,
    () => ({}) as unknown as AudioManager,
  );
  const ids = LANES.slice(0, count).map((instrument, i) => ({
    id: `${instrument}-${i}`,
    instrument,
  }));
  const handles = [];
  for (const lane of ids) {
    handles.push(
      await stage.addHighway(lane.id, {
        track: chart.trackData.find(
          t => t.instrument === lane.instrument,
        ) as Track,
        showDrumLanes: true,
      }),
    );
  }
  const layout = computeStageLayout({
    canvasWidth,
    canvasHeight: CANVAS_HEIGHT,
    highwayCount: count,
  });
  stage.setLayout(
    layout,
    ids.map(lane => lane.id),
  );
  return {stage, layout, ids, handles};
}

describe('highway camera fit on the stage', () => {
  it('keeps every strikeline edge inside its own viewport at the minimum lane width', async () => {
    // Exactly the canvas width at which the layout admits MAX_HIGHWAYS: every
    // rect is MIN_HIGHWAY_PX wide, the narrowest the stage ever renders.
    const canvasWidth =
      MAX_HIGHWAYS * MIN_HIGHWAY_PX + (MAX_HIGHWAYS - 1) * HIGHWAY_GAP_PX;
    const {stage, layout, ids, handles} = await mountStrip(
      canvasWidth,
      MAX_HIGHWAYS,
    );

    expect(layout.maxHighways).toBe(MAX_HIGHWAYS);
    for (const rect of layout.highways) {
      expect(rect.width).toBe(MIN_HIGHWAY_PX);
    }

    for (let i = 0; i < ids.length; i++) {
      const camera = handles[i]!.getCamera();
      const worldX = handles[i]!.getWorldX();
      const halfWidth = HALF_WIDTHS[ids[i].instrument];
      for (const edge of [-halfWidth, halfWidth]) {
        const ndc = project(camera, worldX + edge, STRIKELINE_WORLD_Y);
        // |x| <= 1 is exactly "inside this pass's scissor rect": the rect is
        // what NDC x maps onto.
        expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
        // Not so far inside that the highway has collapsed to a sliver.
        expect(Math.abs(ndc.x)).toBeGreaterThan(0.9);
      }
    }

    stage.destroy();
  });

  it('holds every strikeline at the height a full-width highway puts it', async () => {
    const narrow = await mountStrip(
      MAX_HIGHWAYS * MIN_HIGHWAY_PX + (MAX_HIGHWAYS - 1) * HIGHWAY_GAP_PX,
      MAX_HIGHWAYS,
    );
    const wide = await mountStrip(1400, 1);

    const reference = project(
      wide.handles[0]!.getCamera(),
      wide.handles[0]!.getWorldX(),
      STRIKELINE_WORLD_Y,
    );
    expect(reference.y).toBeLessThan(-0.8);

    for (const handle of narrow.handles) {
      const ndc = project(
        handle!.getCamera(),
        handle!.getWorldX(),
        STRIKELINE_WORLD_Y,
      );
      expect(ndc.y).toBeCloseTo(reference.y, 6);
    }

    narrow.stage.destroy();
    wide.stage.destroy();
  });

  it('leaves the camera untouched when the highway already fits', async () => {
    const {stage, handles} = await mountStrip(1400, 2);
    for (const handle of handles) {
      const camera = handle!.getCamera();
      expect(camera.fov).toBe(90);
      expect(camera.view?.enabled ?? false).toBe(false);
      // Still comfortably inside its own 700px-wide viewport.
      const ndc = project(camera, handle!.getWorldX() + 0.55, -1);
      expect(Math.abs(ndc.x)).toBeLessThan(1);
    }
    stage.destroy();
  });
});
