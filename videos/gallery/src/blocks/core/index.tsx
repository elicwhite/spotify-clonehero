import {Composition, Folder} from 'remotion';
import {CLOCK_DEMO_SEC, ClockDemo} from './ClockDemo';
import {MotionDemo} from './MotionDemo';
import {TextDemo} from './TextDemo';

/** kit-core's blocks: clock and music, motion, text and tokens. */
export const CoreBlocks: React.FC = () => (
  <Folder name="Core">
    <Composition
      id="Core-Clock"
      component={ClockDemo}
      durationInFrames={CLOCK_DEMO_SEC * 60}
      fps={60}
      width={1920}
      height={1080}
      defaultProps={{hero: 270}}
    />
    {/* The same film at another rate and shape: every beat still lands. */}
    <Composition
      id="Core-Clock-Vertical30"
      component={ClockDemo}
      durationInFrames={CLOCK_DEMO_SEC * 30}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{hero: 135}}
    />
    <Composition
      id="Core-Motion"
      component={MotionDemo}
      durationInFrames={180}
      fps={60}
      width={1920}
      height={1080}
      defaultProps={{hero: 90}}
    />
    <Composition
      id="Core-Text"
      component={TextDemo}
      durationInFrames={30}
      fps={30}
      width={1920}
      height={1080}
    />
  </Folder>
);
