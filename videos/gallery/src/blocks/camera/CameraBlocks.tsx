/**
 * The camera area's blocks, cued in seconds. Each names the moments worth
 * looking at in its comment (the stills the gallery renders).
 */
import {useMemo} from 'react';
import {AbsoluteFill} from 'remotion';
import {BrandStage, color, ease, lane} from '@musiccharts/video-kit/brand';
import {
  cameraBlur,
  edgeOnFold,
  IDENTITY_LOCAL,
  makePath,
  mixLocal,
  orbit,
  placeOnPlane,
  PlaneShot,
  project,
  restPose,
  useLens,
  type Local,
  type Pose,
} from '@musiccharts/video-kit/camera';
import {useGlobalFrame} from '@musiccharts/video-kit/clock';
import {softGlow} from '@musiccharts/video-kit/fx';
import {useFormat} from '@musiccharts/video-kit/format';
import {
  glide,
  linear,
  progress,
  type Rect,
} from '@musiccharts/video-kit/motion';
import {Callout, ClickRing, Cursor, PlaneRing} from '@musiccharts/video-kit/ui';
import {BlockLabel, DEMO_BOXES, DEMO_PLANE, DemoPlane} from '../visualShared';

const centre = (b: Rect) => ({x: b.x + b.width / 2, y: b.y + b.height / 2});

/**
 * One camera move over a plane: a dim, racked-out start, a glide into a
 * three-quarter pose with depth of field, a push onto the button that the
 * cursor clicks, a slow orbit throughout and blur on the fast moves. A
 * callout lands on the projected button. Stills: 0.33 s, 1.07 s (moving),
 * 2.33 s.
 */
export const PlaneCameraBlock: React.FC = () => {
  const f = useGlobalFrame();
  const fmt = useFormat();
  const {unit, fps, width, height} = fmt;
  const s = (sec: number) => sec * fps;
  const lens = useLens();
  const button = centre(DEMO_BOXES.button);
  const path = useMemo(
    () =>
      makePath(
        [
          {
            at: 0,
            pose: {
              sx: width / 2,
              sy: height / 2,
              s: 0.5 * unit,
              rx: 16,
              ry: 22,
              rz: -4,
              blur: 6 * unit,
              light: 0.8,
            },
          },
          {
            at: s(2 / 3),
            pose: {
              s: 0.8 * unit,
              rx: 8,
              ry: 18,
              rz: -2,
              blur: 0,
              light: 1,
              dof: 4 * unit,
              focusR: 420 * unit,
            },
            ease: glide,
          },
          {at: s(7 / 6), pose: {s: 0.86 * unit, ry: 15}, ease: linear},
          {
            at: s(5 / 3),
            pose: {
              fx: button.x,
              fy: button.y,
              sx: 0.64 * width,
              sy: 0.46 * height,
              s: 1.5 * unit,
              rx: 6,
              ry: -10,
              rz: 1.5,
              focusR: 300 * unit,
            },
            ease: glide,
          },
          {at: s(3), pose: {s: 1.62 * unit, ry: -12}, ease: linear},
        ],
        restPose(fmt, {x: DEMO_PLANE.width / 2, y: DEMO_PLANE.height / 2}),
      ),
    // Everything else the keys read (fps, unit, size) is in the format.
    [fmt, button.x, button.y],
  );
  const camera = (g: number): Pose => orbit(path(g), g, fps);
  const pose = camera(f);
  const shot = {
    ...pose,
    blur: pose.blur + cameraBlur(camera, f, fmt, {lens}),
  };
  const onScreen = (p: {x: number; y: number}) => project(pose, lens, p);
  const target = onScreen(button);
  const clickAt = s(2.07);
  return (
    <BrandStage glowAt={{x: pose.sx + 200 * unit, y: pose.sy - 200 * unit}}>
      <PlaneShot
        pose={shot}
        lens={lens}
        width={DEMO_PLANE.width}
        height={DEMO_PLANE.height}
        style={{borderRadius: 18, boxShadow: '0 90px 220px rgba(0,0,0,0.75)'}}
        overlay={
          <PlaneRing at={clickAt} box={DEMO_BOXES.button} color={lane.green} />
        }>
        <DemoPlane />
      </PlaneShot>
      <Cursor
        path={[
          {at: s(1.5), x: button.x - 300, y: button.y + 420},
          {at: s(1.97), x: button.x, y: button.y},
        ]}
        clicks={[clickAt]}
        visible={[{appearAt: s(1.43)}]}
        project={onScreen}
      />
      <ClickRing x={target.x} y={target.y} at={clickAt} color={lane.green} />
      <Callout
        at={s(2.2)}
        anchor={target}
        label={{x: target.x - 160 * unit, y: target.y - 260 * unit}}
        color={lane.green}>
        Pinned to the plane
      </Callout>
      <BlockLabel text="camera / makePath + orbit + cameraBlur + PlaneShot + project" />
    </BrandStage>
  );
};

interface Piece {
  box: Rect;
  explode: Partial<Local>;
}

const PIECES: readonly Piece[] = [
  {
    box: {x: 0, y: 0, width: 1440, height: 84},
    explode: {dy: -150, dz: 240, rx: 14, rz: 0.8},
  },
  {
    box: {x: 0, y: 84, width: 320, height: 816},
    explode: {dx: -240, dz: 200, ry: 16, rz: -3},
  },
  {
    box: {x: 320, y: 84, width: 1120, height: 816},
    explode: {dy: 60, dz: 160, rx: -10, rz: 0.6},
  },
  {
    box: DEMO_BOXES.button,
    explode: {dx: 160, dy: -80, dz: 320, rx: -8, rz: -2},
  },
];

/** One piece of the demo plane, clipped to its box. */
const PieceContent: React.FC<{box: Rect}> = ({box}) => (
  <div
    style={{
      width: box.width,
      height: box.height,
      overflow: 'hidden',
      borderRadius: 12,
    }}>
    <div style={{transform: `translate(${-box.x}px, ${-box.y}px)`}}>
      <DemoPlane />
    </div>
  </div>
);

/**
 * Pieces placed on one plane, each with its own full transform: exploded and
 * hovering, assembling from 1/3 s to 4/3 s, then the whole plane folding
 * edge-on from 2 s. A light sits on the button's projected centre. Stills:
 * 0.17 s, 1.67 s, 2.5 s.
 */
export const PlacedPiecesBlock: React.FC = () => {
  const f = useGlobalFrame();
  const fmt = useFormat();
  const {unit, width, height, fps} = fmt;
  const lens = useLens();
  const assembled = ease.enter(progress(f, fps / 3, fps));
  const turn = ease.camera(progress(f, fps / 3, fps));
  const pose: Pose = {
    ...restPose(fmt, {x: DEMO_PLANE.width / 2, y: DEMO_PLANE.height / 2}),
    sx: width / 2,
    sy: height / 2 + 30 * unit * (1 - turn),
    s: (0.62 + 0.1 * turn) * unit,
    rx: 15 * (1 - turn),
    ry: -16 * (1 - turn),
    rz: 1.8 * (1 - turn),
  };
  const foldLine = DEMO_PLANE.height / 2;
  const fold = {
    axisY: foldLine,
    rx:
      edgeOnFold(height / 2, lens) *
      ease.exit(progress(f, 2 * fps, (2 / 3) * fps)),
  };
  const locals = PIECES.map(p =>
    mixLocal({...IDENTITY_LOCAL, ...p.explode}, IDENTITY_LOCAL, assembled),
  );
  const button = PIECES[3] as Piece;
  const light = project(pose, lens, centre(button.box), {
    box: button.box,
    local: locals[3],
    fold,
  });
  return (
    <BrandStage>
      <AbsoluteFill>
        {PIECES.map((p, i) => (
          <div
            key={i}
            style={{
              ...placeOnPlane(pose, lens, {box: p.box, local: locals[i], fold}),
              boxShadow: `0 ${30 * (1 - assembled)}px 60px rgba(0,0,0,${0.5 * (1 - assembled)})`,
              borderRadius: 12,
            }}>
            <PieceContent box={p.box} />
          </div>
        ))}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: softGlow(
            `${light.x}px`,
            `${light.y}px`,
            160 * unit,
            color.purpleHot,
            0.6,
          ),
          mixBlendMode: 'plus-lighter',
        }}
      />
      <BlockLabel text="camera / placeOnPlane (local + fold) + edgeOnFold + project" />
    </BrandStage>
  );
};
