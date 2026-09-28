import {AbsoluteFill} from 'remotion';

export interface VignetteProps {
  /** Corner darkness 0..1 (default 0.55). */
  strength?: number;
  /** Where the darkening starts, as % of the ellipse radius (default 52). */
  start?: number;
}

/**
 * Darkens the frame edges so the eye stays in the middle. One gradient in
 * frame-relative units, so it fits any format.
 */
export const Vignette: React.FC<VignetteProps> = ({
  strength = 0.55,
  start = 52,
}) => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: `radial-gradient(ellipse 72% 78% at 50% 48%, rgba(0,0,0,0) ${start}%, rgba(0,0,0,${strength * 0.32}) ${
        start + (100 - start) * 0.45
      }%, rgba(0,0,0,${strength * 0.72}) ${start + (100 - start) * 0.8}%, rgba(0,0,0,${strength}) 100%)`,
    }}
  />
);
