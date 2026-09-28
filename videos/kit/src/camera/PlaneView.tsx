import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {color} from '../brand/tokens';
import {DepthOfField} from '../fx/DepthOfField';
import {alpha} from '../motion';
import {useLens, type Lens} from './lens';
import {placeOnPlane, type Pose} from './pose';

export interface PlaneViewProps {
  pose: Pose;
  /** The plane's size, plane px. Its top-left corner is plane point (0, 0). */
  width: number;
  height: number;
  /** Default: the format's lens. */
  lens?: Lens;
  /** Style for the plane box: a radius, a shadow, a background. Its transform is the camera's. */
  style?: CSSProperties;
  /** Marks drawn on the plane over its content (PlaneRing, PlaneFlash), in plane px. */
  overlay?: ReactNode;
  children: ReactNode;
}

/**
 * A flat plane (an app screen, a card) seen through the plane camera: one
 * transformed box in a full-frame layer, dimmed by `pose.light`. Its content
 * and overlay tilt with it. Blur and depth of field are `PlaneShot`'s.
 */
export const PlaneView: React.FC<PlaneViewProps> = ({
  pose,
  width,
  height,
  lens,
  style,
  overlay,
  children,
}) => {
  const formatLens = useLens();
  const placed = placeOnPlane(pose, lens ?? formatLens, {
    box: {x: 0, y: 0, width, height},
  });
  return (
    <AbsoluteFill>
      <div
        style={{
          ...style,
          ...placed,
        }}>
        {children}
        {overlay ? (
          <div style={{position: 'absolute', inset: 0}}>{overlay}</div>
        ) : null}
        {pose.light < 1 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: style?.borderRadius,
              background: alpha(color.stage, 1 - pose.light),
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/**
 * A `PlaneView` with the pose's lens effects: depth of field around the
 * pinned point (`dof`, `focusR`) and a whole-plane rack blur (`blur`). Add
 * `cameraBlur(...)` to the pose's `blur` for motion blur on fast moves.
 *
 * The depth of field renders the plane twice, so never put WebGL (the
 * product highway) on the plane.
 */
export const PlaneShot: React.FC<PlaneViewProps> = props => (
  <DepthOfField
    focus={{x: props.pose.sx, y: props.pose.sy}}
    radius={props.pose.focusR}
    blur={props.pose.dof}
    rack={props.pose.blur}>
    <PlaneView {...props} />
  </DepthOfField>
);
