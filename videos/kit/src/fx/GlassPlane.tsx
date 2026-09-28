import type {CSSProperties, ReactNode} from 'react';
import {alpha} from '../motion';
import {color} from '../brand/tokens';

export interface GlassPlaneProps {
  /** Top-left corner, px in the parent. */
  x: number;
  y: number;
  /**
   * CSS `zoom` for the content: the part is laid out again at N times its
   * size, so its type stays crisp (a `scale` would magnify pixels). The bezel
   * (`pad`, `radius`) is in the zoomed space too.
   */
  zoom: number;
  /** Extra CSS transform for the plane (tilts, turns), about `origin`. */
  transform?: string;
  origin?: string;
  /** Glass border around the content, content px (default 10). */
  pad?: number;
  radius?: number;
  /** Colour of the outer glow (default the brand purple). */
  glow?: string;
  /** 0..1: where the moving specular band sits across the glass (default 0.5). */
  sheen?: number;
  /** Whole-plane blur, px. */
  blur?: number;
  opacity?: number;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * A real UI part lifted onto a tilted glass plane: a translucent bezel, a
 * light top edge, deep shadow, a soft outer glow and a moving sheen.
 */
export const GlassPlane: React.FC<GlassPlaneProps> = ({
  x,
  y,
  zoom,
  transform = '',
  origin = '50% 50%',
  pad = 10,
  radius = 16,
  glow = alpha(color.purple, 0.35),
  sheen = 0.5,
  blur = 0,
  opacity = 1,
  style,
  children,
}) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      transformOrigin: origin,
      transform: transform || undefined,
      transformStyle: 'preserve-3d',
      filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
      opacity,
      ...style,
    }}>
    <div
      style={{
        zoom,
        position: 'relative',
        padding: pad,
        borderRadius: radius,
        background:
          'linear-gradient(155deg, rgba(255,255,255,0.13), rgba(255,255,255,0.03) 45%, rgba(255,255,255,0.06))',
        border: '1px solid rgba(255,255,255,0.2)',
        boxShadow: `0 40px 90px rgba(0,0,0,0.7), 0 0 60px ${glow}, inset 0 1px 0 rgba(255,255,255,0.3), inset 0 0 30px rgba(255,255,255,0.03)`,
        overflow: 'hidden',
      }}>
      {children}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          pointerEvents: 'none',
          mixBlendMode: 'screen',
          background: `linear-gradient(115deg, rgba(255,255,255,0) ${sheen * 100 - 30}%, rgba(255,255,255,0.09) ${sheen * 100 - 8}%, rgba(255,255,255,0.02) ${
            sheen * 100
          }%, rgba(255,255,255,0) ${sheen * 100 + 12}%)`,
        }}
      />
    </div>
  </div>
);
