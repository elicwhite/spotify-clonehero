# camera

One plane-camera model. A **pose** pins a point of a flat plane (an app
screen, a card, a window, laid out in its own px) to a point on screen, then
scales and turns the plane about it, with depth of field, blur and
brightness. Seen through a **lens** (perspective distance and origin, from
the format), a pose is exactly the CSS transform the browser draws, so
`project` lands overlays on the plane's pixels.

The product highway is never posed with this camera: it stays in the
player's perspective and moves only in 2D (`highway`'s `screenMove.ts`).

```tsx
import {
  cameraBlur,
  makePath,
  orbit,
  PlaneShot,
  project,
  restPose,
  useLens,
} from '@musiccharts/video-kit/camera';

const fmt = useFormat();
const u = fmt.unit; // plane scale and screen px scale with the format
const lens = useLens();
const path = makePath(
  [
    {at: 0, pose: {sx: fmt.cx, sy: fmt.cy, s: 0.5 * u, ry: 22, blur: 6 * u, light: 0.8}},
    {at: 40, pose: {s: 0.8 * u, ry: 18, blur: 0, light: 1, dof: 4 * u, focusR: 420 * u}, ease: glide},
    {at: 100, pose: {fx: 1280, fy: 134, sx: 0.64 * fmt.width, s: 1.5 * u, ry: -10}, ease: glide},
  ],
  restPose(fmt, {x: 720, y: 450}),
);
const camera = (f: number) => orbit(path(f), f, fmt.fps);
const pose = camera(frame);
const shot = {...pose, blur: pose.blur + cameraBlur(camera, frame, fmt, {lens})};

<PlaneShot pose={shot} width={1440} height={900} overlay={<PlaneRing at={f} box={button} />}>
  <RecordedLayer ... />
</PlaneShot>;
<Callout at={f} anchor={project(pose, lens, {x: 1280, y: 134})} label={...}>One click.</Callout>;
```

## The model (`pose.ts`, `lens.ts`)

| Export                                                                   | What it is                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Pose`                                                                   | `{fx, fy}` plane point pinned to screen point `{sx, sy}`; `z` dolly; `s` scale; `rx, ry, rz` degrees (CSS order); `dof` blur outside the sharp ellipse of radius `focusR`; `blur` rack; `light` 0..1.                                                                  |
| `restPose(frame, at?)`                                                   | No move: plane point `at` (default the frame centre) on the same screen point; `focusR` from the frame height.                                                                                                                                                         |
| `mixPose(a, b, t)`                                                       | Field-by-field mix.                                                                                                                                                                                                                                                    |
| `Lens`, `lensFor(frame, {perspective?, fov?, origin?})`, `useLens(opts)` | Perspective distance (default `LENS_DEPTH` = 2.2 frame heights, about 26 degrees of vertical view) and origin (default the frame centre).                                                                                                                              |
| `planeMatrix(pose, lens, placement?)`                                    | The one matrix of the model: plane px (on a placed piece, with its fold and local move) to screen px, perspective included. `project` measures with it and `placeOnPlane` draws with it, so they cannot disagree.                                                      |
| `project(pose, lens, point, placement?)`                                 | Screen position `{x, y, z, k}` (`PlaneProjection`) of a plane point: `planeMatrix` with the perspective divide; `k` is the perspective scale there. With a `placement`, of a point on a placed piece.                                                                  |
| `placeOnPlane(pose, lens, {box, local?, fold?})`                         | Style for an element occupying `box` on the plane: `planeMatrix` as one CSS `matrix3d` from the element's top-left corner (at left 0, top 0, origin `0 0` of any full-frame layer), so each piece keeps its own blend, filter and opacity. Draw its content at (0, 0). |
| `Local`, `IDENTITY_LOCAL`, `mixLocal`                                    | A piece's own move off its slot: offset (`dz` toward the viewer), rotations about its centre, scale.                                                                                                                                                                   |
| `Fold`, `edgeOnFold(screenY, lens)`                                      | The whole plane folded rigidly about the line `y = axisY`; the angle that turns it edge-on to the eye.                                                                                                                                                                 |
| `PlaneView({pose, width, height, lens?, style, overlay})`                | The plane as one transformed box, dimmed by `light`; `overlay` draws plane-px marks over its content.                                                                                                                                                                  |
| `PlaneShot(...)`                                                         | `PlaneView` inside `DepthOfField` (`dof`, `focusR`, `blur`).                                                                                                                                                                                                           |

## Motion (`path.ts`)

| Export                                                                                    | What it is                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `makePath(keys, base)`                                                                    | A camera path through cumulative keys `{at, pose: Partial<Pose>, ease?}` (default `ease.camera`); holds outside; keys in time order.                                                                                            |
| `orbit(pose, frame, fps, {amount, rx, ry, rz, periodsSec})`                               | A slow turn on three axes out of phase (`periodsSec`: seconds per cycle), so a hold never freezes; `amount` 0 fades it out before a precise landing.                                                                            |
| `cameraBlur(poseAt, frame, {fps, unit}, {lens, spread, windowSec, threshold, gain, max})` | The plane blur a move leaves: screen travel of the pinned point and two neighbours over `windowSec`, above a threshold (reference px, scaled by `unit`). Pass `useFormat()` as the third argument. Add it to the pose's `blur`. |

## Matrices (`matrix.ts`)

`Mat4` (row-major), `multiply`, `compose(...)` (a CSS transform list read left
to right), `translate3d`, `scale3d`, `rotateX/Y/Z`, `perspective`,
`transformPoint`, `projectPoint`, `toMatrix3d`. Same signs as CSS.

## Rules

- The camera is a pure function of the film frame: every scene samples the
  same path, which is what makes cuts between scenes invisible.
- Nothing assumes a frame size: the lens and `restPose` come from the format,
  and cursors and callouts land through `project`.
- `PlaneShot`'s depth of field renders the plane twice: never put WebGL (the
  highway) on the plane.
