import {Composition, Folder} from 'remotion';
import {Film, ScenePreview} from './Film';
import {FORMAT} from './format';
import {board} from './storyboard';

/** The film, then each scene on its own at the same film frames. */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Film"
      component={Film}
      durationInFrames={board.durationInFrames}
      {...FORMAT}
    />
    <Folder name="Scenes">
      {board.scenes.map(scene => (
        <Composition
          key={scene.id}
          id={`scene-${scene.id}`}
          component={ScenePreview}
          defaultProps={{id: scene.id}}
          durationInFrames={scene.to - scene.from}
          {...FORMAT}
        />
      ))}
    </Folder>
  </>
);
