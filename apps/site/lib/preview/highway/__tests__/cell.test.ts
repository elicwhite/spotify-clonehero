import * as THREE from 'three';
import {createEmptyChart, drumTypes, noteTypes} from '@eliwhite/scan-chart';
import {
  buildHighwayCell,
  createHighwayClippingPlanes,
  disposeCellTextures,
  noteClippingPlanesForTrack,
  type CellTextures,
} from '../cell';
import {
  AnimatedTextureManager,
  type HighwayFretLayer,
  type HighwayFretStyle,
  type HighwayFretTextures,
} from '../TextureManager';
import type {ParsedChart} from '../../chorus-chart-processing';
import {resolveNoteGeometry} from '../notePlacement';
import {
  drums4LaneSchema,
  guitarSchema,
  type InstrumentSchema,
} from '../../../chart-edit/instruments';
import type {Track} from '../types';

/** The schema's own X for a pad lane. `InstrumentSchema.lanes[].worldXOffset`
 *  is the single source of truth for lane geometry, so the frets built below
 *  are checked against it and against nothing else. */
function padX(schema: InstrumentSchema, lane: number): number {
  return schema.lanes
    .filter(l => !l.fullWidth)
    .sort((a, b) => a.index - b.index)[lane].worldXOffset;
}

describe('note clipping planes', () => {
  it('relaxes five-fret flame clipping without changing drum clipping', () => {
    const shared = createHighwayClippingPlanes();

    const guitarPlanes = noteClippingPlanesForTrack(
      {instrument: 'guitar'} as Pick<Track, 'instrument'>,
      shared,
    );
    const drumPlanes = noteClippingPlanesForTrack(
      {instrument: 'drums'} as Pick<Track, 'instrument'>,
      shared,
    );

    expect(guitarPlanes).not.toBe(shared.note);
    expect(guitarPlanes[0]).toBeInstanceOf(THREE.Plane);
    expect(guitarPlanes[0].normal.y).toBe(1);
    expect(guitarPlanes[0].constant).toBe(1.1);
    expect(guitarPlanes[1]).toBe(shared.note[1]);
    expect(drumPlanes).toBe(shared.note);
  });
});

describe('cell resource ownership', () => {
  /**
   * A stage keeps one WebGL context alive across every highway toggle, so a
   * removed highway that does not hand its meshes and textures back leaks
   * them for the life of the editor.
   */
  function makeTextures(): CellTextures {
    return {
      highwayTexture: new THREE.Texture(),
      sustainTextures: null,
      flameTextures: null,
      fretTextures: null,
      getTextureForNote: () => new THREE.SpriteMaterial(),
      animatedTextureManager: new AnimatedTextureManager(),
    };
  }

  it('removes and releases the meshes it added, leaving the shared floor texture alone', async () => {
    const root = new THREE.Group();
    const textures = makeTextures();
    const core = await buildHighwayCell(root, {
      chart: createEmptyChart({
        bpm: 120,
        resolution: 480,
      }) as unknown as ParsedChart,
      track: null,
      textureLoader: new THREE.TextureLoader(),
      textures,
      clippingPlanes: createHighwayClippingPlanes(),
      highwaySpeed: 1.5,
      showDrumLanes: false,
    });

    // The floor plus the plain strikeline.
    const meshes = root.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    expect(meshes).toHaveLength(2);
    const geometries = meshes.map(mesh => jest.spyOn(mesh.geometry, 'dispose'));
    const materials = meshes.map(mesh =>
      jest.spyOn(mesh.material as THREE.Material, 'dispose'),
    );
    const floorTexture = jest.spyOn(textures.highwayTexture, 'dispose');

    core.disposeMeshes();

    expect(root.children).toHaveLength(0);
    for (const geometry of geometries) expect(geometry).toHaveBeenCalled();
    for (const material of materials) expect(material).toHaveBeenCalled();
    // The scrolling floor texture belongs to CellTextures, not to the mesh
    // that samples it.
    expect(floorTexture).not.toHaveBeenCalled();

    disposeCellTextures(textures);
    expect(floorTexture).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Strikeline fret spacing
// ---------------------------------------------------------------------------

/**
 * The frets on the strikeline come from `InstrumentSchema.lanes[].worldXOffset`
 * by way of `buildHighwayCell`'s `fretConfig`, and so do the approaching notes
 * (`resolveNoteGeometry`). What this pins is that the schema's numbers are the
 * right ones: a drum highway is narrower than a five-fret one *and* has fewer
 * pads, so a spacing derived from the five-fret lane count packs the four drum
 * buttons closer than one button is wide and the strikeline reads as a single
 * scrunched blob.
 */
describe('strikeline fret spacing', () => {
  /** Source fret sprites are 192x96 imported at 975 pixels per world unit. */
  const FRET_SOURCE = {width: 192, height: 96};
  const FRET_SPRITE_WIDTH =
    (FRET_SOURCE.height / 975) * (FRET_SOURCE.width / FRET_SOURCE.height);

  function makeFretTextures(): HighwayFretTextures {
    const styles: HighwayFretStyle[] = ['first', 'second', 'third'];
    const layers: HighwayFretLayer[] = [
      'base',
      'inner_color',
      'cover',
      'half_cover',
      'head',
      'head_light',
      'pick',
    ];
    const textures = {} as HighwayFretTextures;
    for (const style of styles) {
      const byLayer = {} as Record<HighwayFretLayer, THREE.Texture>;
      for (const layer of layers) {
        const texture = new THREE.Texture();
        texture.image = FRET_SOURCE;
        byLayer[layer] = texture;
      }
      textures[style] = byLayer;
    }
    return textures;
  }

  function makeTextures(): CellTextures {
    return {
      highwayTexture: new THREE.Texture(),
      sustainTextures: null,
      flameTextures: null,
      fretTextures: makeFretTextures(),
      getTextureForNote: () => new THREE.SpriteMaterial(),
      animatedTextureManager: new AnimatedTextureManager(),
    };
  }

  /** Distinct fret centers on the strikeline, left to right. */
  async function fretCenters(
    instrument: Track['instrument'],
    drumType: number = drumTypes.fourLane,
  ) {
    const root = new THREE.Group();
    await buildHighwayCell(root, {
      chart: {
        ...(createEmptyChart({bpm: 120, resolution: 480}) as object),
        drumType,
      } as unknown as ParsedChart,
      track: {
        instrument,
        difficulty: 'expert',
        noteEventGroups: [],
        starPowerSections: [],
        soloSections: [],
        flexLanes: [],
        drumFreestyleSections: [],
        rejectedChartModifiers: [],
      } as unknown as Track,
      textureLoader: new THREE.TextureLoader(),
      textures: makeTextures(),
      clippingPlanes: createHighwayClippingPlanes(),
      highwaySpeed: 1.5,
      showDrumLanes: true,
    });

    const sprites: THREE.Sprite[] = [];
    root.traverse(object => {
      if (object instanceof THREE.Sprite) sprites.push(object);
    });
    expect(sprites.length).toBeGreaterThan(0);
    for (const sprite of sprites) {
      expect(sprite.scale.x).toBeCloseTo(FRET_SPRITE_WIDTH, 5);
    }
    return Array.from(new Set(sprites.map(sprite => sprite.position.x))).sort(
      (a, b) => a - b,
    );
  }

  it('spreads four drum frets across the drum highway without overlapping', async () => {
    const centers = await fretCenters('drums');

    expect(centers).toHaveLength(4);
    for (let lane = 0; lane < centers.length; lane++) {
      // Approaching notes land on the fret they are aimed at.
      expect(centers[lane]).toBeCloseTo(padX(drums4LaneSchema, lane), 6);
    }
    // Centered on the highway.
    expect(centers[0]).toBeCloseTo(-centers[3], 6);
    expect(centers[1]).toBeCloseTo(-centers[2], 6);
    // Evenly spaced, and every gap clears the sprite drawn at each center --
    // this is the assertion the old five-lane-derived spacing failed.
    for (let i = 1; i < centers.length; i++) {
      const gap = centers[i] - centers[i - 1];
      expect(gap).toBeCloseTo(centers[1] - centers[0], 6);
      expect(gap).toBeGreaterThan(FRET_SPRITE_WIDTH);
    }
    // The whole strikeline stays on the 0.9-wide drum floor.
    expect(centers[3] + FRET_SPRITE_WIDTH / 2).toBeLessThan(0.45);
    // And uses most of it: four buttons on a narrow highway should not huddle
    // in the middle.
    const span = centers[3] - centers[0] + FRET_SPRITE_WIDTH;
    expect(span / 0.9).toBeGreaterThan(0.85);
  });

  it('lines five-lane drum notes up with the five frets they are aimed at', async () => {
    const centers = await fretCenters('drums', drumTypes.fiveLane);

    expect(centers).toHaveLength(5);
    // Five pads on the same 0.9-wide floor sit closer together than four, so
    // the four shared lanes are NOT at their 4-lane X positions.
    expect(centers[1]).not.toBeCloseTo(padX(drums4LaneSchema, 1), 3);
    // What matters is that the notes follow the frets: a note resolved with
    // the chart's drum type lands on its fret, not on the 4-lane position.
    const padNoteTypes = [
      noteTypes.redDrum,
      noteTypes.yellowDrum,
      noteTypes.blueDrum,
    ];
    for (let lane = 0; lane < padNoteTypes.length; lane++) {
      const geometry = resolveNoteGeometry(
        'drums',
        {type: padNoteTypes[lane], flags: 0},
        drumTypes.fiveLane,
      );
      expect(geometry?.lane).toBe(lane);
      expect(geometry?.xPosition).toBeCloseTo(centers[lane], 6);
    }
    // Still centered and still on the floor.
    expect(centers[0]).toBeCloseTo(-centers[4], 6);
    expect(centers[4] + FRET_SPRITE_WIDTH / 2).toBeLessThan(0.45);
  });

  it('leaves the five-fret frets where they are', async () => {
    const centers = await fretCenters('guitar');

    expect(centers).toHaveLength(5);
    for (let lane = 0; lane < centers.length; lane++) {
      expect(centers[lane]).toBeCloseTo(padX(guitarSchema, lane), 6);
      expect(centers[lane]).toBeCloseTo(-0.386 + 0.193 * lane, 6);
    }
    expect(centers[4] + FRET_SPRITE_WIDTH / 2).toBeLessThan(0.55);
  });
});
