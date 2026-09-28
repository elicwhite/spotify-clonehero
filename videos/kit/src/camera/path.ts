/**
 * Camera motion over time: keyed paths, a slow orbit that keeps holds alive,
 * and the blur a fast camera move leaves. Every function takes the film frame,
 * so the camera is one pure function of time and survives any cut.
 */
import type {Format} from '../format';
import {ease} from '../brand/ease';
import {keyed, wave, type EasingFn, type Keyframe, type Point} from '../motion';
import type {Lens} from './lens';
import {mixPose, project, type Pose} from './pose';

/** A camera key: the pose fields that change at film frame `at`. */
export interface PoseKey {
  at: number;
  /** Only what changes from the previous key; the rest carries over. */
  pose: Partial<Pose>;
  /** Easing of the move ARRIVING at this key (default `ease.camera`). */
  ease?: EasingFn;
}

/**
 * A camera path through cumulative keys: each key states only what changes,
 * starting from `base`. Holds the first pose before the first key and the
 * last after the last. Keys must be in time order.
 *
 * ```ts
 * const path = makePath([
 *   {at: 0, pose: {s: 0.6, ry: 22, blur: 6}},
 *   {at: 90, pose: {s: 1.05, ry: 26, blur: 0, dof: 4}, ease: glide},
 * ], restPose(format));
 * const pose = path(frame);
 * ```
 */
export const makePath = (
  keys: readonly PoseKey[],
  base: Pose,
): ((frame: number) => Pose) => {
  if (keys.length === 0) return () => base;
  const full: Keyframe<Pose>[] = [];
  let prev = base;
  for (const k of keys) {
    const last = full[full.length - 1];
    if (last && k.at < last.at)
      throw new Error(
        `[camera] keys must be in time order: ${k.at} comes after ${last.at}`,
      );
    prev = {...prev, ...k.pose};
    full.push({at: k.at, value: prev, ease: k.ease});
  }
  return frame => keyed(frame, full, mixPose, ease.camera);
};

export interface OrbitOptions {
  /** 0..1 multiplier on the whole orbit (fade it out before a precise landing). */
  amount?: number;
  /** Peak wander per axis, degrees. */
  rx?: number;
  ry?: number;
  rz?: number;
  /** Seconds per cycle per axis; out of phase so the three never all stop. */
  periodsSec?: {rx: number; ry: number; rz: number};
}

/**
 * A slow, never-ending turn added on top of a pose (a few tenths of a degree
 * per second on three axes), so a held shot never freezes.
 */
export const orbit = (
  pose: Pose,
  frame: number,
  fps: number,
  o: OrbitOptions = {},
): Pose => {
  const k = o.amount ?? 1;
  if (k === 0) return pose;
  const t = frame / fps;
  const per = o.periodsSec ?? {rx: 12.8, ry: 9.8, rz: 16.5};
  return {
    ...pose,
    rx: pose.rx + k * (o.rx ?? 1) * wave(t, per.rx, 1.3),
    ry: pose.ry + k * (o.ry ?? 1.5) * wave(t, per.ry),
    rz: pose.rz + k * (o.rz ?? 0.5) * wave(t, per.rz, 2.1),
  };
};

export interface CameraBlurOptions {
  lens: Lens;
  /** Plane offsets from the pinned point sampled with it (default ±300, ±200 plane px). */
  spread?: Point;
  /** Seconds the screen travel is measured over (default 1/30). */
  windowSec?: number;
  /** Travel below this leaves no blur, px (default 10 reference px). */
  threshold?: number;
  /** Blur px per px of travel above the threshold (default 0.09). */
  gain?: number;
  /** Cap, px (default 9 reference px). */
  max?: number;
}

/**
 * The plane blur a camera move leaves: how far the pinned point and two
 * plane points around it travel on screen over `windowSec`, turned into a
 * small whole-plane blur (add it to the pose's `blur`). Zero while the
 * camera holds or drifts slowly.
 */
export const cameraBlur = (
  poseAt: (frame: number) => Pose,
  frame: number,
  {fps, unit}: Pick<Format, 'fps' | 'unit'>,
  o: CameraBlurOptions,
): number => {
  const spread = o.spread ?? {x: 300, y: 200};
  const a = poseAt(frame);
  const b = poseAt(frame - (o.windowSec ?? 1 / 30) * fps);
  const points: Point[] = [
    {x: a.fx, y: a.fy},
    {x: a.fx - spread.x, y: a.fy - spread.y},
    {x: a.fx + spread.x, y: a.fy + spread.y},
  ];
  let travel = 0;
  for (const p of points) {
    const pa = project(a, o.lens, p);
    const pb = project(b, o.lens, p);
    travel += Math.hypot(pa.x - pb.x, pa.y - pb.y) / points.length;
  }
  const blur = (travel - (o.threshold ?? 10 * unit)) * (o.gain ?? 0.09);
  return Math.min(o.max ?? 9 * unit, Math.max(0, blur));
};
