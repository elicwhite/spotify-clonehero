/**
 * The brand's easing presets, built from motion's curves and the `curves`
 * tokens: `ease.enter` for anything arriving, `ease.exit` for anything
 * leaving, `ease.camera` for camera moves. Pure, so Node code can use them.
 */
import {bezier, quintOut, sineInOut} from '../motion/easing';
import {curves} from './tokens';

export const ease = {
  enter: bezier(...curves.enter),
  exit: bezier(...curves.exit),
  camera: bezier(...curves.camera),
  /** Gentle in-out for slow drifts and holds. */
  drift: sineInOut,
  /** A crisp settle for small UI moves. */
  settle: quintOut,
} as const;
