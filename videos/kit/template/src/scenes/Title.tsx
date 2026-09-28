/**
 * The title: a headline whose words land on the first bar's beats, a
 * caption, and four drum gems from the app's own art that punch on every
 * beat, with a ring on each downbeat. Every frame comes from the cues.
 */
import {useMemo} from 'react';
import {
  Gem,
  lane,
  space,
  useLayout,
  type GemSprite,
} from '@musiccharts/video-kit/brand';
import {useGlobalFrame, useHitPulse} from '@musiccharts/video-kit/clock';
import {Shockwave} from '@musiccharts/video-kit/fx';
import {useFormat} from '@musiccharts/video-kit/format';
import {useTimeline} from '@musiccharts/video-kit/music';
import {KineticText} from '@musiccharts/video-kit/text';
import {TITLE, titleCues} from '../cues';

/** One gem per beat of the bar, left to right. */
const GEMS: readonly GemSprite[] = [
  'drum-tom-red',
  'drum-tom-yellow',
  'drum-tom-blue',
  'drum-tom-green',
];

export const Title: React.FC = () => {
  const tl = useTimeline();
  const cues = useMemo(() => titleCues(tl), [tl]);
  const frame = useGlobalFrame();
  const {unit, cx, height, safeWidth} = useFormat();
  const layout = useLayout();
  const punch = useHitPulse(cues.beats, 0.25);
  const onBeat = tl.beatAt(frame)?.beat;
  const gap = 48 * unit;
  const gemWidth = Math.min(
    150 * unit,
    (safeWidth - (GEMS.length - 1) * gap) / GEMS.length,
  );
  const gemsY = height * 0.68;

  return (
    <>
      {cues.downbeats.map(at => (
        <Shockwave
          key={at}
          at={at}
          x={cx}
          y={gemsY}
          color={lane.blue}
          intensity={0.6}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: gemsY - gemWidth / 2,
          display: 'flex',
          justifyContent: 'center',
          gap,
        }}>
        {GEMS.map((sprite, i) => (
          <Gem
            key={sprite}
            sprite={sprite}
            width={gemWidth}
            style={{
              transform: `scale(${1 + (onBeat === i ? 0.2 * punch : 0)})`,
            }}
          />
        ))}
      </div>
      <div
        style={{position: 'absolute', left: layout.slateX, top: layout.slateY}}>
        <KineticText
          text={TITLE.headline}
          variant="h1"
          maxWidth={layout.headlineMaxWidth}
          enterAt={cues.words}
          exitAt={cues.out}
        />
        <KineticText
          text={TITLE.caption}
          variant="caption"
          maxWidth={layout.captionMaxWidth}
          enter="fadeUp"
          enterAt={cues.captionAt}
          exitAt={cues.out}
          style={{marginTop: space.slateCaptionGap * unit}}
        />
      </div>
    </>
  );
};
