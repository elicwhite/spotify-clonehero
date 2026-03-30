import * as THREE from 'three';
import type {ElementRenderer} from './SceneReconciler';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGHWAY_HALF_WIDTH = 0.45;

// ---------------------------------------------------------------------------
// MarkerElementData
// ---------------------------------------------------------------------------

export interface MarkerElementData {
  text: string;
  isSelected?: boolean;
}

// ---------------------------------------------------------------------------
// Texture cache
// ---------------------------------------------------------------------------

const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Create a text label texture for a marker flag.
 * White text on a semi-transparent colored background.
 *
 * Uses the same 2x-resolution canvas approach as the existing
 * createSectionTexture in SceneOverlays for crisp text rendering.
 */
function createMarkerTexture(
  text: string,
  color: [number, number, number],
  isSelected: boolean,
): THREE.CanvasTexture {
  const key = `${text}:${color.join(',')}:${isSelected}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // Render at 2x resolution for crisp text on high-DPI
  const scale = 2;
  const fontSize = 24 * scale;
  const padding = 16 * scale;

  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  canvas.width = textWidth + padding * 2;
  canvas.height = 36 * scale;

  // Background -- marker color with transparency
  const [r, g, b] = color;
  const bgAlpha = isSelected ? 0.6 : 0.35;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${bgAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Selected border
  if (isSelected) {
    ctx.strokeStyle = `rgba(${Math.min(255, r + 100)}, ${Math.min(255, g + 100)}, ${Math.min(255, b + 100)}, 0.9)`;
    ctx.lineWidth = 3 * scale;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  }

  // Text -- white
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  textureCache.set(key, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// MarkerRenderer
// ---------------------------------------------------------------------------

/**
 * Configurable ElementRenderer for all marker types (sections, lyrics,
 * BPM changes, time signatures, vocal phrases).
 *
 * Each instance is parameterised by side (left/right) and color (RGB).
 * The reconciler registers one instance per marker kind.
 */
export class MarkerRenderer implements ElementRenderer<MarkerElementData> {
  private clippingPlanes: THREE.Plane[];
  private side: 'left' | 'right';
  private color: [number, number, number];

  constructor(
    clippingPlanes: THREE.Plane[],
    side: 'left' | 'right',
    color: [number, number, number],
  ) {
    this.clippingPlanes = clippingPlanes;
    this.side = side;
    this.color = color;
  }

  create(data: MarkerElementData): THREE.Group {
    const group = new THREE.Group();

    // 1. Text flag sprite
    const texture = createMarkerTexture(
      data.text,
      this.color,
      data.isSelected ?? false,
    );
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    material.clippingPlanes = this.clippingPlanes;

    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 8;

    // Scale proportional to texture aspect ratio
    const texCanvas = texture.image as HTMLCanvasElement;
    const aspect = texCanvas.width / texCanvas.height;
    const flagHeight = 0.055;
    sprite.scale.set(flagHeight * aspect, flagHeight, 1);

    if (this.side === 'right') {
      // Right side: anchor at left edge so it extends rightward
      sprite.center.set(0.0, 0.5);
      sprite.position.set(HIGHWAY_HALF_WIDTH + 0.02, 0, 0.001);
    } else {
      // Left side: anchor at right edge so it extends leftward
      sprite.center.set(1.0, 0.5);
      sprite.position.set(-HIGHWAY_HALF_WIDTH - 0.02, 0, 0.001);
    }

    group.add(sprite);

    // 2. Thin colored horizontal line across the highway
    const [r, g, b] = this.color;
    const lineColor = new THREE.Color(r / 255, g / 255, b / 255);
    const lineGeom = new THREE.PlaneGeometry(HIGHWAY_HALF_WIDTH * 2, 0.003);
    const lineMat = new THREE.MeshBasicMaterial({
      color: lineColor,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    lineMat.clippingPlanes = this.clippingPlanes;
    const lineMesh = new THREE.Mesh(lineGeom, lineMat);
    lineMesh.renderOrder = 2;
    lineMesh.position.set(0, 0, 0.001);

    group.add(lineMesh);

    return group;
  }

  recycle(group: THREE.Group): void {
    // Dispose all children's materials and geometries
    for (const child of group.children) {
      if (child instanceof THREE.Sprite) {
        (child.material as THREE.SpriteMaterial).dispose();
      } else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.MeshBasicMaterial).dispose();
      }
    }
  }

  /** Clear the shared texture cache. Call on dispose. */
  static clearTextureCache(): void {
    for (const texture of textureCache.values()) {
      texture.dispose();
    }
    textureCache.clear();
  }
}
