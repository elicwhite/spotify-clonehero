import * as THREE from 'three';
import {loadTexture} from './TextureManager';
import {WaveformSurface, type WaveformSurfaceConfig} from './WaveformSurface';
import {GridOverlay, type GridOverlayConfig} from './GridOverlay';

// ---------------------------------------------------------------------------
// Highway scene setup -- camera, renderer, highway mesh, strikeline
// ---------------------------------------------------------------------------

export type HighwayMode = 'classic' | 'waveform';

// ---------------------------------------------------------------------------
// Waveform + Grid creation helpers
// ---------------------------------------------------------------------------

/**
 * Creates a WaveformSurface and adds it to the scene at renderOrder 0.
 * Returns the instance for update/dispose lifecycle management.
 */
export function createWaveformSurface(
  scene: THREE.Scene,
  config: WaveformSurfaceConfig,
): WaveformSurface {
  const surface = new WaveformSurface(config);
  scene.add(surface.getMesh());
  return surface;
}

/**
 * Creates a GridOverlay and adds it to the scene at renderOrder 1.
 * Returns the instance for update/dispose lifecycle management.
 */
export function createGridOverlay(
  scene: THREE.Scene,
  config: GridOverlayConfig,
): GridOverlay {
  const overlay = new GridOverlay(config);
  scene.add(overlay.getMesh());
  return overlay;
}

export async function getHighwayTexture(textureLoader: THREE.TextureLoader) {
  const texture = await loadTexture(
    textureLoader,
    '/assets/preview/assets/highways/wor.png',
  );

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  texture.repeat.set(1, 2);
  return texture;
}

export function createHighway(highwayTexture: THREE.Texture) {
  const mat = new THREE.MeshBasicMaterial({map: highwayTexture});

  const geometry = new THREE.PlaneGeometry(1, 2);
  const plane = new THREE.Mesh(geometry, mat);
  plane.position.y = -0.1;
  plane.renderOrder = 1;
  return plane;
}

export function createDrumHighway(highwayTexture: THREE.Texture) {
  const mat = new THREE.MeshBasicMaterial({map: highwayTexture});

  const geometry = new THREE.PlaneGeometry(0.9, 2);
  const plane = new THREE.Mesh(geometry, mat);
  plane.position.y = -0.1;
  plane.renderOrder = 1;
  return plane;
}

export async function loadAndCreateHitBox(textureLoader: THREE.TextureLoader) {
  const texture = await loadTexture(
    textureLoader,
    '/assets/preview/assets/isolated.png',
  );

  const material = new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: true,
    transparent: true,
  });

  const aspectRatio = texture.image.width / texture.image.height;

  material.depthTest = false;
  material.transparent = true;

  const scale = 0.19;
  const sprite = new THREE.Sprite(material);
  if (aspectRatio > 1) {
    // Texture is wider than it is tall
    sprite.scale.set(aspectRatio * scale, 1 * scale, 1);
  } else {
    // Texture is taller than it is wide or square
    sprite.scale.set(1 * scale, (1 / aspectRatio) * scale, 1);
  }
  sprite.position.y = -1;
  sprite.renderOrder = 3;

  return sprite;
}

export async function loadAndCreateDrumHitBox(textureLoader: THREE.TextureLoader) {
  const texture = await loadTexture(
    textureLoader,
    '/assets/preview/assets/isolated-drums.png',
  );

  const material = new THREE.SpriteMaterial({
    map: texture,
    sizeAttenuation: true,
    transparent: true,
  });

  const aspectRatio = texture.image.width / texture.image.height;

  material.depthTest = false;
  material.transparent = true;

  const scale = 0.19;
  const sprite = new THREE.Sprite(material);
  if (aspectRatio > 1) {
    // Texture is wider than it is tall
    sprite.scale.set(aspectRatio * scale, 1 * scale, 1);
  } else {
    // Texture is taller than it is wide or square
    sprite.scale.set(1 * scale, (1 / aspectRatio) * scale, 1);
  }
  sprite.position.y = -1;
  sprite.renderOrder = 3;

  return sprite;
}
