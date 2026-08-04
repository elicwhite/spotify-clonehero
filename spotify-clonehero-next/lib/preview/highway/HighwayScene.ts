import * as THREE from 'three';
import {
  loadTexture,
  type HighwayFretLayer,
  type HighwayFretStyle,
  type HighwayFretTextures,
} from './TextureManager';
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
 * Creates a WaveformSurface and adds it under `root` at renderOrder 0.
 * Returns the instance for update/dispose lifecycle management.
 */
export function createWaveformSurface(
  root: THREE.Object3D,
  config: WaveformSurfaceConfig,
): WaveformSurface {
  const surface = new WaveformSurface(config);
  root.add(surface.getMesh());
  return surface;
}

/**
 * Creates a GridOverlay and adds it under `root`.
 * Returns the instance for update/dispose lifecycle management.
 */
export function createGridOverlay(
  root: THREE.Object3D,
  config: GridOverlayConfig,
  clippingPlanes?: THREE.Plane[],
): GridOverlay {
  const overlay = new GridOverlay(config, clippingPlanes);
  root.add(overlay.getMesh());
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

/** Lane positions and colors used to compose the original fret-button art. */
export interface HighwayFretHitboxConfig {
  laneXs: number[];
  laneColors: string[];
}

const FRET_PATTERN: Record<
  4 | 5,
  Array<{style: HighwayFretStyle; flipHorizontal: boolean}>
> = {
  4: [
    {style: 'first', flipHorizontal: false},
    {style: 'second', flipHorizontal: false},
    {style: 'second', flipHorizontal: true},
    {style: 'first', flipHorizontal: true},
  ],
  5: [
    {style: 'first', flipHorizontal: false},
    {style: 'second', flipHorizontal: false},
    {style: 'third', flipHorizontal: false},
    {style: 'second', flipHorizontal: true},
    {style: 'first', flipHorizontal: true},
  ],
};

/**
 * The fret sources are 192x96 sprites imported at 975 pixels per Unity unit.
 * Their authored pivot is at y=.39, which is the point that belongs on the
 * playline. The pick layer is the dark raised arc behind the button visible in
 * the original highway, so it is included even though six-lane charts are not
 * supported by the editor.
 */
const FRET_SPRITE_HEIGHT = 96 / 975;
// The editor highway camera compresses world-space verticals toward the
// playline. Preserve the source width while giving the layered button its
// reference silhouette and circular head height.
const FRET_RENDER_HEIGHT = FRET_SPRITE_HEIGHT * 1.2;
const FRET_SPRITE_PIVOT_Y = 0.39;
const FRET_LAYERS: HighwayFretLayer[] = [
  'pick',
  'base',
  'inner_color',
  'half_cover',
  'head_light',
  'head',
  // The cover is the authored outer-ring mask. It must sit above the head so
  // the lane color remains visible around the complete button.
  'cover',
];

function createFretHitbox(
  fretTextures: HighwayFretTextures,
  config: HighwayFretHitboxConfig,
): THREE.Group | null {
  const laneCount = config.laneXs.length;
  if (laneCount !== 4 && laneCount !== 5) return null;

  const pattern = FRET_PATTERN[laneCount];
  const group = new THREE.Group();
  group.position.y = -1;
  group.renderOrder = 3;

  for (let lane = 0; lane < laneCount; lane += 1) {
    const {style, flipHorizontal} = pattern[lane];
    const source = fretTextures[style];
    for (const layer of FRET_LAYERS) {
      const sourceTexture = source[layer];
      const texture = flipHorizontal ? sourceTexture.clone() : sourceTexture;
      if (texture !== sourceTexture) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.repeat.x = -1;
        texture.offset.x = 1;
        texture.needsUpdate = true;
      }
      const material = new THREE.SpriteMaterial({
        map: texture,
        color:
          layer === 'cover' ? config.laneColors[lane] || '#FFFFFF' : '#FFFFFF',
        transparent: true,
        depthTest: false,
      });
      // Foreground hitline art stays bright and should not be dimmed by the
      // far-end highway fog used for approaching notes.
      material.fog = false;
      const sprite = new THREE.Sprite(material);
      const aspectRatio = texture.image.width / texture.image.height;
      sprite.center.set(0.5, FRET_SPRITE_PIVOT_Y);
      sprite.scale.set(FRET_SPRITE_HEIGHT * aspectRatio, FRET_RENDER_HEIGHT, 1);
      sprite.position.x = config.laneXs[lane];
      sprite.renderOrder = 3 + FRET_LAYERS.indexOf(layer) * 0.01;
      group.add(sprite);
    }
  }

  return group;
}

/**
 * Loads the strikeline hitbox sprite. `texturePath` comes from the active
 * track's `InstrumentSchema.hitboxTexturePath`.
 */
export async function loadAndCreateHitBox(
  textureLoader: THREE.TextureLoader,
  texturePath: string,
  fretTextures?: HighwayFretTextures | null,
  fretConfig?: HighwayFretHitboxConfig | null,
) {
  if (fretTextures && fretConfig) {
    const fretHitbox = createFretHitbox(fretTextures, fretConfig);
    if (fretHitbox) return fretHitbox;
  }

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
