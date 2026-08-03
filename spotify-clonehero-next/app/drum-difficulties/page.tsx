import type {Metadata} from 'next';
import DrumDifficultiesClient from './DrumDifficultiesClient';

export const metadata: Metadata = {
  title: 'Drum Difficulty Generation',
  description:
    'Drop a pro-drums chart with an Expert track to generate Hard, Medium, ' +
    'and Easy difficulties, then fine-tune them in the chart editor.',
};

export default function Page() {
  return <DrumDifficultiesClient />;
}
