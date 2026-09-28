/**
 * The plane camera: a pose pins a plane point to a screen point with scale,
 * rotation, depth of field, blur and light; keyed paths, a slow orbit and
 * motion blur move it; `project` lands overlays on the plane's pixels. See
 * README.md.
 */
export {
  lensFor,
  LENS_DEPTH,
  useLens,
  type Lens,
  type LensOptions,
} from './lens';
export {
  compose,
  IDENTITY,
  multiply,
  perspective,
  projectPoint,
  rotateX,
  rotateY,
  rotateZ,
  scale3d,
  toMatrix3d,
  transformPoint,
  translate3d,
  type Mat4,
  type Point3,
  type PlaneProjection,
  type Transformed,
} from './matrix';
export {
  cameraBlur,
  makePath,
  orbit,
  type CameraBlurOptions,
  type OrbitOptions,
  type PoseKey,
} from './path';
export {PlaneShot, PlaneView, type PlaneViewProps} from './PlaneView';
export {
  edgeOnFold,
  IDENTITY_LOCAL,
  mixLocal,
  mixPose,
  placeOnPlane,
  planeMatrix,
  project,
  restPose,
  type Fold,
  type Local,
  type Placement,
  type Pose,
} from './pose';
