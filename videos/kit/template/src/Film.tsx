/**
 * The film: its music, the film clock, the brand stage, and each scene in
 * its storyboard window. `ScenePreview` shows one scene on its own, at the
 * same film frames and with the same music, so it renders as it does in
 * the film.
 */
import {useMemo, type ReactNode} from 'react';
import {BrandStage} from '@musiccharts/video-kit/brand';
import {FilmClock, SceneWindow} from '@musiccharts/video-kit/clock';
import {TimelineProvider, useTimeline} from '@musiccharts/video-kit/music';
import {soundtrack, timeline} from './music';
import {End} from './scenes/End';
import {Title} from './scenes/Title';
import {board, type SceneId} from './storyboard';

const SCENES: Record<SceneId, React.FC> = {title: Title, end: End};

/**
 * The film's music around every composition, the film and each preview: the
 * timeline, and the soundtrack's curves once the film has them.
 */
const Music: React.FC<{children: ReactNode}> = ({children}) => (
  <TimelineProvider
    timeline={timeline}
    peaks={soundtrack.peaks}
    envelopes={soundtrack.envelopes}
    writtenBy="the soundtrack build (README.md)">
    {children}
  </TimelineProvider>
);

/** Fails the render when a scene no longer starts on its bar. */
const OnTheGrid: React.FC<{children: ReactNode}> = ({children}) => {
  const tl = useTimeline();
  const problems = useMemo(
    () => board.checkStoryboard(bar => tl.frameOfBeat(bar)),
    [tl],
  );
  if (problems.length > 0) {
    throw new Error(`The storyboard is off the beat: ${problems.join('; ')}`);
  }
  return children;
};

export const Film: React.FC = () => (
  <Music>
    <OnTheGrid>
      <FilmClock src={soundtrack.mix}>
        <BrandStage>
          {board.scenes.map(scene => {
            const Scene = SCENES[scene.id];
            return (
              <SceneWindow key={scene.id} {...board.window(scene.id)}>
                <Scene />
              </SceneWindow>
            );
          })}
        </BrandStage>
      </FilmClock>
    </OnTheGrid>
  </Music>
);

export const ScenePreview: React.FC<{id: SceneId}> = ({id}) => {
  const Scene = SCENES[id];
  return (
    <Music>
      <SceneWindow {...board.window(id)} audio={soundtrack.mix}>
        <BrandStage>
          <Scene />
        </BrandStage>
      </SceneWindow>
    </Music>
  );
};
