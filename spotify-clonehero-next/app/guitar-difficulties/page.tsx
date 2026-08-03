import type {Metadata} from 'next';
import GuitarDifficultiesClient from './GuitarDifficultiesClient';

export const metadata: Metadata = {
  title: 'Guitar Difficulty Generation',
  description:
    'Drop a chart with an Expert guitar track to generate Hard, Medium, ' +
    'and Easy difficulties, then fine-tune them in the chart editor.',
};

export default function Page() {
  return <GuitarDifficultiesClient />;
}
