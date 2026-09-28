/**
 * One recorded component of a running app, showing the recorded frame for
 * the current GLOBAL film frame (or any film frame you pass). See README.md.
 */
import type {CSSProperties} from 'react';
import {OffthreadVideo, Sequence, useCurrentFrame} from 'remotion';
import {useGlobalFrame} from '../clock';
import {publicUrl} from '../load';
import {recordedComponent, recordingPath, type RecordingRef} from './manifest';
import {useRecording} from './useRecording';

export interface RecordedLayerProps {
  /** The take (its folder under the film's public dir). */
  recording: RecordingRef;
  /** Component name from the manifest: window, or one the take cropped out. */
  component: string;
  /**
   * Film frame whose recording to show. Default: the current global film
   * frame (1:1 with the film clock). Pass your own to freeze or retime.
   */
  frame?: number;
  /**
   * 'box' (default): absolutely positioned at the component's real place in
   * the recorded viewport, at CSS size (the video holds device pixels, so it
   * stays crisp up to the take's device scale). 'fill': fills its parent box.
   */
  fit?: 'box' | 'fill';
  /** Outside the take: render nothing (default) or hold the first/last frame. */
  hold?: 'none' | 'clamp';
  style?: CSSProperties;
  className?: string;
}

export const RecordedLayer: React.FC<RecordedLayerProps> = ({
  recording,
  component,
  frame,
  fit = 'box',
  hold = 'none',
  style,
  className,
}) => {
  const manifest = useRecording(recording);
  const global = useGlobalFrame();
  const local = useCurrentFrame();
  if (!manifest) return null;
  const comp = recordedComponent(manifest, component);
  const {from, count} = manifest.range;
  const wanted = Math.round(frame ?? global) - from;
  const inside = wanted >= 0 && wanted < count;
  if (!inside && hold === 'none') return null;
  const index = Math.min(count - 1, Math.max(0, wanted));
  const scale = manifest.viewport.deviceScaleFactor;

  const placement: CSSProperties =
    fit === 'box'
      ? {
          position: 'absolute',
          left: comp.crop.x / scale,
          top: comp.crop.y / scale,
          width: comp.crop.width / scale,
          height: comp.crop.height / scale,
        }
      : {position: 'absolute', inset: 0};

  // The video's frame `index` has to show on this composition frame: a
  // Sequence that started `index` frames ago does exactly that. Following the
  // film clock 1:1 its `from` is constant, so the Studio plays the video
  // continuously; retimed or held it moves every frame and the video seeks.
  // (Freeze does not reach OffthreadVideo's frame extraction when rendering.)
  return (
    <div
      className={className}
      style={{...placement, overflow: 'hidden', ...style}}>
      <Sequence
        from={local - index}
        durationInFrames={count}
        layout="none"
        name={`${recording.id}/${component}`}>
        <OffthreadVideo
          src={publicUrl(recordingPath(recording, comp.file))}
          muted
          // BT.709 SDR encoded straight from sRGB screenshots: decode as-is,
          // with no HDR tone mapping.
          toneMapped={false}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'fill',
          }}
        />
      </Sequence>
    </div>
  );
};
