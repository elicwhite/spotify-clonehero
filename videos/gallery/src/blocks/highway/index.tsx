import {Composition, Folder} from 'remotion';
import {
  ChartFolderDemo,
  EditsDemo,
  PanelDemo,
  PlateDemo,
  SMOKE_DEMO_SEC,
  SmokeDemo,
  SplitDemo,
  StripDemo,
  WarpedDemo,
} from './HighwayDemos';

const FPS = 60;
const FORMAT = {fps: FPS, width: 1920, height: 1080} as const;
const frames = (sec: number) => Math.round(sec * FPS);

/**
 * kit-product's highway blocks, all on the kit's invented test chart.
 * `Highway-Smoke` is the smoke check: its render fails when the product
 * highway draws black or out of sync.
 */
export const HighwayBlocks: React.FC = () => (
  <Folder name="Highway">
    <Composition
      id="Highway-Strip"
      component={StripDemo}
      durationInFrames={frames(2)}
      {...FORMAT}
      defaultProps={{hero: frames(1)}}
    />
    <Composition
      id="Highway-Smoke"
      component={SmokeDemo}
      durationInFrames={frames(SMOKE_DEMO_SEC)}
      {...FORMAT}
      defaultProps={{hero: frames(0.75)}}
    />
    <Composition
      id="Highway-Edits"
      component={EditsDemo}
      durationInFrames={frames(2)}
      {...FORMAT}
      defaultProps={{hero: frames(0.83)}}
    />
    <Composition
      id="Highway-Panel"
      component={PanelDemo}
      durationInFrames={frames(1)}
      {...FORMAT}
      defaultProps={{hero: frames(0.5)}}
    />
    <Composition
      id="Highway-Plate"
      component={PlateDemo}
      durationInFrames={frames(1.5)}
      {...FORMAT}
      defaultProps={{hero: frames(1)}}
    />
    <Composition
      id="Highway-Warped"
      component={WarpedDemo}
      durationInFrames={frames(1)}
      {...FORMAT}
      defaultProps={{hero: frames(0.5)}}
    />
    <Composition
      id="Highway-Split"
      component={SplitDemo}
      durationInFrames={frames(1)}
      {...FORMAT}
      defaultProps={{hero: frames(0.98)}}
    />
    <Composition
      id="Highway-ChartFolder"
      component={ChartFolderDemo}
      durationInFrames={frames(1)}
      {...FORMAT}
      defaultProps={{hero: frames(0.5)}}
    />
  </Folder>
);
