/**
 * kit-product's recorder blocks, on the recorder's self-test take (a small
 * test page recorded under the virtual clock; no product material):
 *
 *   node --import tsx kit/scripts/recorder/selftest.mjs --cdp <chrome> \
 *     --keep gallery/public/generated/rec
 *
 * - Recorder-Take: the take's components pulled apart on the stage, each at
 *   its recorded place and scaled up together, with the recorded pointer
 *   retraced by the ui area's Cursor.
 * - Recorder-FrameCheck: the whole recorded window at the take's own size
 *   on one film frame, to compare with the harness's screenshot of it.
 */
import {AbsoluteFill, Composition, Folder} from 'remotion';
import {stageBackground} from '@musiccharts/video-kit/brand';
import {useFormat} from '@musiccharts/video-kit/format';
import {
  recordedCursorPath,
  RecordedLayer,
  useRecording,
  type RecordingRef,
} from '@musiccharts/video-kit/recorder';
import {Cursor} from '@musiccharts/video-kit/ui';

const SELFTEST: RecordingRef = {
  root: 'generated/rec',
  id: 'recorder-selftest',
  writtenBy:
    'node --import tsx kit/scripts/recorder/selftest.mjs --cdp <chrome> --keep gallery/public/generated/rec',
};

/** How much of the stage the take's viewport fills, at most. */
const FILL = 0.8;

const TakeDemo: React.FC = () => {
  const {width, height, unit} = useFormat();
  const manifest = useRecording(SELFTEST);
  if (!manifest) return null;
  const parts = Object.keys(manifest.components).filter(n => n !== 'window');
  // The take's viewport, scaled onto the middle of the stage.
  const view = manifest.viewport;
  const scale = FILL * Math.min(width / view.width, height / view.height);
  const offset = {
    x: (width - view.width * scale) / 2,
    y: (height - view.height * scale) / 2,
  };
  // Nudges in the take's CSS px that read as `unit`-sized on the stage.
  const nudge = (10 * unit) / scale;
  return (
    <AbsoluteFill style={{background: stageBackground}}>
      <div
        style={{
          position: 'absolute',
          left: offset.x,
          top: offset.y,
          width: view.width,
          height: view.height,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}>
        <RecordedLayer
          recording={SELFTEST}
          component="window"
          style={{opacity: 0.35}}
        />
        {parts.map((name, i) => (
          <RecordedLayer
            key={name}
            recording={SELFTEST}
            component={name}
            style={{
              transform: `translate(${(i % 2 ? 1 : -1) * nudge}px, ${-nudge}px)`,
              boxShadow:
                '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.18)',
              borderRadius: 6,
            }}
          />
        ))}
      </div>
      <Cursor
        {...recordedCursorPath(manifest)}
        project={p => ({x: offset.x + p.x * scale, y: offset.y + p.y * scale})}
      />
    </AbsoluteFill>
  );
};

interface FrameCheckProps extends Record<string, unknown> {
  /** The film frame to show. */
  filmFrame: number;
}

const FrameCheck: React.FC<FrameCheckProps> = ({filmFrame}) => (
  <AbsoluteFill style={{background: '#000'}}>
    <RecordedLayer recording={SELFTEST} component="window" frame={filmFrame} />
  </AbsoluteFill>
);

export const RecorderBlocks: React.FC = () => (
  <Folder name="Recorder">
    {/* The self-test take: 45 frames at 60 fps. */}
    <Composition
      id="Recorder-Take"
      component={TakeDemo}
      durationInFrames={45}
      fps={60}
      width={1920}
      height={1080}
      defaultProps={{hero: 25}}
    />
    {/* One frame at the take's rate: a take plays frame for frame. */}
    <Composition
      id="Recorder-FrameCheck"
      component={FrameCheck}
      durationInFrames={1}
      fps={60}
      width={960}
      height={540}
      defaultProps={{filmFrame: 24}}
    />
  </Folder>
);
