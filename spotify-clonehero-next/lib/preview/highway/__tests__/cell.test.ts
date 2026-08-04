import * as THREE from 'three';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {
  buildHighwayCell,
  createHighwayClippingPlanes,
  disposeCellTextures,
  noteClippingPlanesForTrack,
  type CellTextures,
} from '../cell';
import {AnimatedTextureManager} from '../TextureManager';
import type {ParsedChart} from '../../chorus-chart-processing';
import type {Track} from '../types';

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
