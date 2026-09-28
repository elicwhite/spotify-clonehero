import {AbsoluteFill} from 'remotion';
import {color} from '../brand/tokens';
import {alpha} from '../motion';

export interface SideShadeProps {
  side: 'left' | 'right';
  /** Darkness at the edge, 0..1 (default 0.8). */
  strength?: number;
  /** How far across the frame the shade reaches, 0..1 (default 0.5). */
  width?: number;
  /** Shade colour (default the stage floor). */
  color?: string;
}

/**
 * A hard-light wash from one side of the frame: separates the headline half
 * from the UI half so type reads over a busy plane.
 */
export const SideShade: React.FC<SideShadeProps> = ({
  side,
  strength = 0.8,
  width = 0.5,
  color: c = color.stage,
}) => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: `linear-gradient(${side === 'left' ? 90 : 270}deg, ${alpha(c, strength)} 0%, ${alpha(
        c,
        strength * 0.75,
      )} ${width * 60}%, ${alpha(c, 0)} ${width * 100}%)`,
    }}
  />
);
