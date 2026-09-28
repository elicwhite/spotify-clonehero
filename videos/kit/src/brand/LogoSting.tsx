/**
 * The Blender logo sting player: an RGBA PNG sequence of square frames plus
 * its meta JSON (the kit's `blender/logo_sting.py` writes both: the frames
 * into `<folder>/`, the meta beside it as `<folder>.json`). The meta's type,
 * check and cues are in `stingMeta.ts`.
 */
import type {CSSProperties} from 'react';
import {Img} from 'remotion';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {loadJson, publicUrl, useLoaded} from '../load';
import {
  assertStingMeta,
  checkSting,
  STING_WRITTEN_BY,
  type StingMeta,
} from './stingMeta';

/** Loads and checks a sting meta: every field, before anything plays it. */
const loadStingMeta = async (path: string): Promise<StingMeta> => {
  const meta = await loadJson<unknown>(path, {writtenBy: STING_WRITTEN_BY});
  assertStingMeta(meta);
  return meta;
};

/**
 * The sting's meta, loaded and checked once per page; null (with the frame
 * held) until it is in. `path` is the JSON's public path (default
 * `<folder>.json`).
 */
export const useStingMeta = (path: string): StingMeta | null =>
  useLoaded(
    `logo-sting:${path}`,
    () => loadStingMeta(path),
    'Loading the logo sting',
  );

export interface LogoStingProps {
  meta: StingMeta;
  /**
   * The frames: a public folder holding `<NNNN>.png`, or a function giving
   * each frame's URL.
   */
  src: string | ((index: number) => string);
  /** On-screen centre of the resting mark, px. */
  x: number;
  y: number;
  /** On-screen side of the resting square, px (default: the sting's own, at 1:1). */
  size?: number;
  /** Film frame of sting frame 0 (default `meta.globalStart`); re-time it with `TimeShift`. */
  start?: number;
  style?: CSSProperties;
}

/**
 * Plays the sting at its film position: nothing before the mark appears,
 * then one frame per film frame, holding the last rest frame after the end.
 * The mark's rest centre lands on (x, y) and its rest square is `size` px.
 */
export const LogoSting: React.FC<LogoStingProps> = ({
  meta,
  src,
  x,
  y,
  size,
  start = meta.globalStart,
  style,
}) => {
  const frame = useGlobalFrame();
  const {fps} = useFormat();
  checkSting(meta, fps);
  const local = Math.round(frame) - start;
  if (local < meta.appearFrame) return null;
  const i = Math.min(meta.frames - 1, local);
  const k = (size ?? meta.rest.squarePx) / meta.rest.squarePx;
  const side = meta.frameSizePx * k;
  const [cx, cy] = meta.rest.centerPx;
  const url =
    typeof src === 'string'
      ? publicUrl(`${src}/${String(i).padStart(meta.digits, '0')}.png`)
      : src(i);
  return (
    <Img
      src={url}
      style={{
        position: 'absolute',
        left: x - cx * k,
        top: y - cy * k,
        width: side,
        height: side,
        display: 'block',
        ...style,
      }}
    />
  );
};
