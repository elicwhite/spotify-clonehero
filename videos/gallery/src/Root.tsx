import {CoreBlocks} from './blocks/core';
import {HighwayBlocks} from './blocks/highway';
import {RecorderBlocks} from './blocks/recorder';
import {VisualBlocks} from './blocks/visualBlocks';

/** One composition per kit block, grouped by the area that owns it. */
export const RemotionRoot: React.FC = () => (
  <>
    <CoreBlocks />
    <HighwayBlocks />
    <RecorderBlocks />
    <VisualBlocks />
  </>
);
