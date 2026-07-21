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
 * Creates a GridOverlay and adds it to the scene.
 * Returns the instance for update/dispose lifecycle management.
 */
export function createGridOverlay(
  scene: THREE.Scene,
  config: GridOverlayConfig,
  clippingPlanes?: THREE.Plane[],
): GridOverlay {
  const overlay = new GridOverlay(config, clippingPlanes);
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

/**
 * Render order for the highway floor planes. Lower than the waveform
 * surface (1) so the waveform draws on top when both are visible — this
 * keeps the gray plane as a frame around the waveform without occluding
 * it. Markers, notes, and overlays render at higher orders still.
 */
const HIGHWAY_FLOOR_RENDER_ORDER = 0;

/**
 * Creates the classic highway floor plane. `width` comes from the active
 * track's `InstrumentSchema.highwayWidth` (drums render narrower than
 * five-fret instruments).
 */
export function createHighway(highwayTexture: THREE.Texture, width: number) {
  const mat = new THREE.MeshBasicMaterial({map: highwayTexture});

  const geometry = new THREE.PlaneGeometry(width, 2);
  const plane = new THREE.Mesh(geometry, mat);
  plane.position.y = -0.1;
  plane.renderOrder = HIGHWAY_FLOOR_RENDER_ORDER;
  return plane;
}

/**
 * Highway width used when there's no active notes track to take
 * `InstrumentSchema.highwayWidth` from (vocals/global scopes — add-lyrics).
 * Matches the drum width so the grid overlay (0.9) and waveform surface
 * (0.84) line up the same way they do on a drum track.
 */
export const LANES_OFF_HIGHWAY_WIDTH = 0.9;

/**
 * The strikeline for scopes with no hitbox sprite (vocals/global). Notes
 * place "now" at worldY = -1; without the instrument's hitbox art there's
 * nothing else marking that line, so draw a thin bright bar there.
 */
export function createPlainStrikeline(width: number) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const geometry = new THREE.PlaneGeometry(width, 0.012);
  const plane = new THREE.Mesh(geometry, mat);
  plane.position.y = -1;
  plane.renderOrder = 2;
  return plane;
}

/**
 * Loads the strikeline hitbox sprite. `texturePath` comes from the active
 * track's `InstrumentSchema.hitboxTexturePath`.
 */
export async function loadAndCreateHitBox(
  textureLoader: THREE.TextureLoader,
  texturePath: string,
) {
  const texture = await loadTexture(textureLoader, texturePath);

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
