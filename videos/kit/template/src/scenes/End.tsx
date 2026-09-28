/**
 * The end card: the logo lands on the scene's first downbeat, then the title
 * and the address. A film with a soundtrack drops `credit={false}`: the card
 * then credits the music from the timeline's meta.
 */
import {useMemo} from 'react';
import {EndCard} from '@musiccharts/video-kit/brand';
import {useTimeline} from '@musiccharts/video-kit/music';
import {endCard} from '../cues';

export const End: React.FC = () => {
  const tl = useTimeline();
  const card = useMemo(() => endCard(tl), [tl]);
  return <EndCard {...card} credit={false} />;
};
