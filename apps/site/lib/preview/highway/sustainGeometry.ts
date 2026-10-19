import * as THREE from 'three';

/** The source dimensions and Unity top border for
 * `spr_sustain_strip6.png`'s 73×70 fret frame. The top border is the rounded
 * far-end cap; the bottom of the source is the flat join hidden by the note. */
const FRETTED_SOURCE_WIDTH = 73;
const FRETTED_SOURCE_HEIGHT = 70;
const FRETTED_TOP_BORDER = 38;

/** Full source-plane width relative to a fret gem. Transparent side padding
 * in the original sprite means 0.3 made the visible tail too thin. */
export const FRETTED_SUSTAIN_WIDTH_MULTIPLIER = 0.5;

/** Convert chart duration to highway world-space length. The highway's note
 * position advances by `speed` world units per second, so this conversion is
 * deliberately not doubled. */
export function highwaySustainWorldHeight(
  msLength: number,
  highwaySpeed: number,
): number {
  return Math.max(0, (msLength / 1000) * highwaySpeed);
}

/**
 * Create a sustain plane without stretching the fretted sprite's far cap.
 * Three.js's default PlaneGeometry has one vertical UV span, so a long tail
 * would turn the rounded source cap into an imperceptible rectangle. Two
 * vertical geometry spans let the source body stretch while keeping the cap
 * at the same world-space size as the note art.
 */
export function createHighwaySustainGeometry(
  width: number,
  height: number,
  fretted: boolean,
): THREE.PlaneGeometry {
  if (!fretted || height <= 0) {
    return new THREE.PlaneGeometry(width, height);
  }

  const capHeight = Math.min(
    height / 2,
    (width * FRETTED_TOP_BORDER) / FRETTED_SOURCE_WIDTH,
  );
  if (capHeight <= 0) {
    return new THREE.PlaneGeometry(width, height);
  }

  const geometry = new THREE.PlaneGeometry(width, height, 1, 2);
  // Test doubles and very small renderer shims may expose only the geometry
  // disposal surface. They still get the correct dimensions; UV refinement
  // is only needed when real BufferAttributes are available.
  if (typeof geometry.getAttribute !== 'function') return geometry;
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  const sourceCapV = 1 - FRETTED_TOP_BORDER / FRETTED_SOURCE_HEIGHT;

  for (let i = 0; i < positions.count; i++) {
    const normalizedY = (positions.getY(i) + height / 2) / height;
    if (normalizedY > 0.75) {
      positions.setY(i, height / 2);
      uvs.setY(i, 1);
    } else if (normalizedY > 0.25) {
      positions.setY(i, height / 2 - capHeight);
      uvs.setY(i, sourceCapV);
    } else {
      positions.setY(i, -height / 2);
      uvs.setY(i, 0);
    }
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
