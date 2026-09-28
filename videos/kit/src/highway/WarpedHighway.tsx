/**
 * One highway with its floor warped onto any screen quad: the app's canvas,
 * reframed from outside with a projective transform (the floor quad of a
 * single full-box pane onto the target). Gem sprites face the app camera, so
 * they read stretched when the floor is flattened; keep such states brief.
 */
import type {CSSProperties} from 'react';
import {useVideoConfig} from 'remotion';
import {
  offsetQuad,
  quadBounds,
  quadToQuadMatrix3d,
  type Quad,
  type Rect,
} from '../motion';
import type {CroppedHighwayProps} from './compositing';
import {EXPERT_DRUMS, type TrackRef} from './editing';
import {highwayInstrumentOf} from './floor';
import {floorQuad, type HighwayBox} from './highwayGeometry';
import {ProductHighway} from './ProductHighway';

/**
 * The wrapper that warps the canvas's floor onto `target`: a div at `bounds`
 * with overflow hidden, transform-origin 0 0 and this transform, holding the
 * full-box highway at (-bounds.x, -bounds.y). Only the floor's own box is
 * warped: the canvas above the floor runs toward the plane's horizon, which
 * a flattening map sends to infinity.
 */
export const floorWarp = (
  box: HighwayBox,
  track: TrackRef,
  target: Quad,
): {bounds: Rect; transform: string} => {
  const floor = floorQuad(box, highwayInstrumentOf(track));
  const bounds = quadBounds(floor);
  const toLocal = (q: Quad) => offsetQuad(q, -bounds.x, -bounds.y);
  return {
    bounds,
    transform: quadToQuadMatrix3d(toLocal(floor), toLocal(target)),
  };
};

export interface WarpedHighwayProps extends CroppedHighwayProps {
  /**
   * The box the highway is drawn in before the warp, one pane filling it.
   * Default: the composition size (the app's full-frame view).
   */
  box?: HighwayBox;
  /** Where the floor lands on screen: far-left, far-right, near-right, near-left. */
  target: Quad;
  /** Extra style on the warped wrapper (it already carries the transform and `mix-blend-mode: lighten`). */
  style?: CSSProperties;
  /** Style on the canvas box inside the warp (filters here stay inside the blend). */
  canvasStyle?: CSSProperties;
}

/**
 * The wrapper is the element that meets the stage, so it carries
 * `mix-blend-mode: lighten` (the canvas's black drops into the stage). Do not
 * put a transform, filter or opacity on an ancestor between it and the
 * stage: that isolates it and the black comes back. Compose extra moves into
 * `target` instead.
 */
export const WarpedHighway: React.FC<WarpedHighwayProps> = ({
  track = EXPERT_DRUMS,
  box,
  target,
  style,
  canvasStyle,
  showLyrics = false,
  ...highway
}) => {
  const video = useVideoConfig();
  const size = box ?? {width: video.width, height: video.height};
  const {bounds, transform} = floorWarp(size, track, target);
  return (
    <div
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        overflow: 'hidden',
        transformOrigin: '0 0',
        transform,
        mixBlendMode: 'lighten',
        ...style,
      }}>
      <ProductHighway
        {...highway}
        panes={[{track}]}
        width={size.width}
        height={size.height}
        showLyrics={showLyrics}
        style={{
          position: 'absolute',
          left: -bounds.x,
          top: -bounds.y,
          ...canvasStyle,
        }}
      />
    </div>
  );
};
