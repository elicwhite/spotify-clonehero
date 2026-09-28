import type {CSSProperties} from 'react';
import {AbsoluteFill, continueRender, delayRender} from 'remotion';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {rand, rng} from '../motion';

const TILE = 512;

/**
 * One 512 px tile of seeded monochrome noise, built once per page and
 * decoded before any frame is captured (a CSS background that is still
 * decoding would drop the grain from random frames).
 */
const makeTile = (): string | null => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(TILE, TILE);
  const r = rng('film-grain-tile');
  // White noise, softened with a wrap-around [1 2 1] blur in both directions:
  // grain clumps of ~1.5 px that survive H.264 and still tile seamlessly.
  // Softening by scaling the tile instead makes a periodic moire.
  const white = new Float32Array(TILE * TILE);
  for (let i = 0; i < white.length; i++) white[i] = r.gauss();
  const at = (x: number, y: number) =>
    white[((y + TILE) % TILE) * TILE + ((x + TILE) % TILE)] as number;
  const soft = new Float32Array(TILE * TILE);
  let sumSq = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const h = (y2: number) => at(x - 1, y2) + 2 * at(x, y2) + at(x + 1, y2);
      const v = (h(y - 1) + 2 * h(y) + h(y + 1)) / 16;
      soft[y * TILE + x] = v;
      sumSq += v * v;
    }
  }
  const norm = 46 / Math.sqrt(sumSq / soft.length);
  for (let i = 0; i < TILE * TILE; i++) {
    const v = Math.max(0, Math.min(255, 128 + (soft[i] as number) * norm));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  const handle = delayRender('Decoding the film grain tile');
  const el = new Image();
  el.src = url;
  el.decode().then(
    () => continueRender(handle),
    () => continueRender(handle),
  );
  return url;
};

const tileUrl = makeTile();

export interface GrainProps {
  /** Layer opacity (default 0.035). */
  opacity?: number;
  /** Pattern changes per second (default 30: filmic; the frame rate = fizz). */
  rate?: number;
  /**
   * Whole-number grain scale (default: the format's size unit, rounded, so
   * the grain keeps its size relative to the frame). Fractional scales moire.
   */
  size?: number;
  blend?: CSSProperties['mixBlendMode'];
  seed?: string;
}

/**
 * Animated, deterministic film grain: one tiled background whose offset jumps
 * `rate` times a second. Effectively free, and it dithers the stage gradients
 * so they do not band in H.264.
 *
 * Grain is a layer blended over everything under it, so it changes those
 * pixels. It must never sit over the product highway: on a highway shot,
 * leave it out (`<BrandStage grain={false}>`) or keep it under the highway.
 */
export const Grain: React.FC<GrainProps> = ({
  opacity = 0.035,
  rate = 30,
  size,
  blend = 'normal',
  seed = 'grain',
}) => {
  const f = useGlobalFrame();
  const {fps, unit} = useFormat();
  if (!tileUrl || opacity <= 0) return null;
  const scale = Math.max(1, Math.round(size ?? unit));
  const step = Math.floor((f / fps) * rate + 1e-6);
  const ox = Math.floor(rand(seed, step, 'x') * TILE * scale);
  const oy = Math.floor(rand(seed, step, 'y') * TILE * scale);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${tileUrl})`,
        backgroundSize: `${TILE * scale}px ${TILE * scale}px`,
        backgroundPosition: `${ox}px ${oy}px`,
        imageRendering: scale > 1 ? 'pixelated' : undefined,
        opacity,
        mixBlendMode: blend,
        pointerEvents: 'none',
      }}
    />
  );
};
