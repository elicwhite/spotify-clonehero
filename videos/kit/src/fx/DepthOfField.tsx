import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import type {Point} from '../motion';

export interface DepthOfFieldProps {
  /** The screen point that stays sharp, px. */
  focus: Point;
  /** Vertical radius of the sharp ellipse, px (it is `aspect` times as wide). */
  radius: number;
  /** Blur outside the ellipse, px. Below 0.3 the children render once. */
  blur: number;
  /** Blur over everything (rack focus), px. */
  rack?: number;
  /** Width over height of the sharp ellipse (default 1.35). */
  aspect?: number;
  /** Fraction of the radius that is fully sharp before the falloff (default 0.5). */
  core?: number;
  children: ReactNode;
}

/**
 * Depth of field for a flat scene: everything soft except an ellipse around
 * `focus`. Two passes: the children blurred, and the children again, sharp,
 * masked to the ellipse on top.
 *
 * It RENDERS ITS CHILDREN TWICE while `blur` is on. Never wrap WebGL in it
 * (the product highway or any three.js canvas): each pass would be its own
 * renderer and context, at twice the cost, and the two could disagree. Wrap
 * DOM planes only, and keep the highway outside.
 */
export const DepthOfField: React.FC<DepthOfFieldProps> = ({
  focus,
  radius,
  blur,
  rack = 0,
  aspect = 1.35,
  core = 0.5,
  children,
}) => {
  const rackBlur = rack > 0.2 ? `blur(${rack}px)` : undefined;
  if (blur <= 0.3) {
    return <AbsoluteFill style={{filter: rackBlur}}>{children}</AbsoluteFill>;
  }
  const mask = `radial-gradient(ellipse ${radius * aspect}px ${radius}px at ${focus.x}px ${focus.y}px, #000 ${core * 100}%, rgba(0,0,0,0) 100%)`;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{filter: `blur(${blur + rack}px)`}}>
        {children}
      </AbsoluteFill>
      <AbsoluteFill
        style={{filter: rackBlur, maskImage: mask, WebkitMaskImage: mask}}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
