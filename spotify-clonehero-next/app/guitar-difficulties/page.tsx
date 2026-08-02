import type {Metadata} from 'next';
import GuitarDifficultiesClient from './GuitarDifficultiesClient';

export const metadata: Metadata = {
  title: 'Guitar Difficulty Comparison',
  description:
    'Select a chart and compare Expert, Hard, Medium, and Easy five-fret guitar reductions side by side.',
};

export default function Page() {
  return <GuitarDifficultiesClient />;
}
