import type {Metadata} from 'next';
import GuitarDifficultiesClient from './GuitarDifficultiesClient';

export const metadata: Metadata = {
  title: 'Guitar Difficulty Preview',
  description:
    'Compare Expert, Hard, Medium, and Easy five-fret guitar charts using a frozen reduction-model preview snapshot.',
};

export default function Page() {
  return <GuitarDifficultiesClient />;
}
